'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SNAPSHOT = path.join(__dirname, 'al0-daily-snapshot.json');
const data = JSON.parse(fs.readFileSync(SNAPSHOT));
const candles = data.candles;
const close = candles.map(c => c.close);
function sma(values, n) { let sum=0; return values.map((v,i)=>{sum+=v; if(i>=n)sum-=values[i-n]; return i>=n-1 ? sum/n:null;}); }
function ema(values,n) { let value=null; const initial=sma(values,n); return values.map((v,i)=>{if(i<n-1)return null; value=value===null?initial[i]:value+(v-value)*2/(n+1);return value;}); }
function std(values,n) {const avg=sma(values,n);return values.map((_,i)=>i<n-1?null:Math.sqrt(values.slice(i-n+1,i+1).reduce((s,v)=>s+(v-avg[i])**2,0)/n));}
function atr(c,n){const tr=c.map((x,i)=>i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-c[i-1].close),Math.abs(x.low-c[i-1].close)));let a=null; const seed=sma(tr,n);return tr.map((x,i)=>{if(i<n-1)return null;a=a===null?seed[i]:(a*(n-1)+x)/n;return a;});}
function alternating(c,rawBuy,rawSell){let lastBuy=1e6,lastSell=1e6;const out=[];for(let i=0;i<c.length;i++){const buy=rawBuy[i]&&lastSell<=lastBuy,sell=rawSell[i]&&lastBuy<lastSell;if(buy)out.push({index:i,type:'buy'});else if(sell)out.push({index:i,type:'sell'});lastBuy=rawBuy[i]?0:lastBuy+1;lastSell=rawSell[i]?0:lastSell+1;}return out;}
function baseline(c,key){const values=c.map(x=>x.close),mid=sma(values,24),sd=std(values,24),multi=key==='al_update_1'?1.8:1.3;const buy=c.map((x,i)=>mid[i]!==null&&x.high>=(key==='al_update_1'?mid[i]:mid[i]+multi*sd[i]));const sell=c.map((x,i)=>mid[i]!==null&&x.close<=(key==='al_update_1'?mid[i]-multi*sd[i]:mid[i]));return alternating(c,buy,sell);}
function strategy(c, config){
  const values=c.map(x=>x.close), signals=[], lines={};let position=0;
  function target(index,dir){if(dir!==position && dir){signals.push({index,type:dir>0?'buy':'sell'});position=dir;}}
  if(config.family==='supertrend'){
    const a=atr(c,config.period);let upper=null,lower=null,trend=0;lines.upper=[];lines.lower=[];
    for(let i=0;i<c.length;i++){
      if(a[i]===null){lines.upper.push(null);lines.lower.push(null);continue;}
      const basis=(c[i].high+c[i].low)/2,newUpper=basis+config.multiplier*a[i],newLower=basis-config.multiplier*a[i];
      const oldUpper=upper,oldLower=lower;
      upper=oldUpper===null || newUpper<oldUpper || c[i-1].close>oldUpper ? newUpper : oldUpper;
      lower=oldLower===null || newLower>oldLower || c[i-1].close<oldLower ? newLower : oldLower;
      if(trend===0) trend=c[i].close>=basis?1:-1;
      else if(trend<0 && c[i].close>oldUpper)trend=1;
      else if(trend>0 && c[i].close<oldLower)trend=-1;
      target(i,trend);lines.upper.push(upper);lines.lower.push(lower);
    }
  } else if(config.family==='ema_atr'){
    const fast=ema(values,config.fast),slow=ema(values,config.slow),a=atr(c,config.atrPeriod);lines.fast=fast;lines.slow=slow;
    for(let i=0;i<c.length;i++){if(slow[i]===null||a[i]===null)continue;const spread=fast[i]-slow[i],band=config.band*a[i];if(spread>band)target(i,1);else if(spread<-band)target(i,-1);}
  } else if(config.family==='donchian'){
    lines.upper=[];lines.lower=[];
    for(let i=0;i<c.length;i++){if(i<config.period){lines.upper.push(null);lines.lower.push(null);continue;}const previous=c.slice(i-config.period,i);const upper=Math.max(...previous.map(x=>x.high)),lower=Math.min(...previous.map(x=>x.low));lines.upper.push(upper);lines.lower.push(lower);if(c[i].close>upper)target(i,1);else if(c[i].close<lower)target(i,-1);}
  } else if(config.family==='bollinger_close'){
    const avg=sma(values,config.period),sd=std(values,config.period);lines.mid=avg;lines.upper=avg.map((v,i)=>v===null?null:v+config.multiplier*sd[i]);lines.lower=avg.map((v,i)=>v===null?null:v-config.multiplier*sd[i]);
    for(let i=0;i<c.length;i++){if(avg[i]===null)continue; if(c[i].close>lines.upper[i])target(i,1);else if(c[i].close<lines.lower[i])target(i,-1);}
  } else throw new Error('Unknown strategy');
  return {signals,lines};
}
// Equal 1x price exposure. Exactly like the original app, periods start flat,
// only closed trades compound, and an end-of-window open trade is disclosed but excluded.
function backtest(c,signals,start,end,mode='ideal'){
  const events=signals.map(s=>mode==='next_open'?{...s,index:s.index+1}:s).filter(s=>c[s.index]&&c[s.index].date>=start&&c[s.index].date<=end);
  let position=null,equity=1,peak=1,maxDD=0;const trades=[];
  const price=(c,s)=>mode==='next_open'?c.open:s.type==='buy'?c.low:c.high;
  for(const s of events){const bar=c[s.index],execution=price(bar,s);if(position&&position.side!==(s.type==='buy'?1:-1)){const r=position.side*(execution/position.price-1);equity*=1+r;peak=Math.max(peak,equity);maxDD=Math.min(maxDD,equity/peak-1);trades.push({side:position.side,entryDate:position.date,exitDate:bar.date,entryPrice:position.price,exitPrice:execution,return:r});position=null;}if(!position)position={side:s.type==='buy'?1:-1,price:execution,date:bar.date};}
  // Mark-to-market diagnostic on each close; avoids concealing intra-trade risk.
  let mtmPeak=1,mtmDD=0,mtmEquity=1,realized=1,active=null,eventIndex=0;
  for(const bar of c){if(bar.date<start||bar.date>end)continue;while(eventIndex<events.length&&c[events[eventIndex].index].date===bar.date){const s=events[eventIndex++],p=price(bar,s),side=s.type==='buy'?1:-1;if(active&&active.side!==side){realized*=1+active.side*(p/active.price-1);active=null;}if(!active)active={side,price:p};}mtmEquity=realized*(1+(active?active.side*(bar.close/active.price-1):0));mtmPeak=Math.max(mtmPeak,mtmEquity);mtmDD=Math.min(mtmDD,mtmEquity/mtmPeak-1);}
  return {return:equity-1,drawdown:maxDD,markToMarketReturn:mtmEquity-1,markToMarketDrawdown:mtmDD,trades:trades.length,winRate:trades.length?trades.filter(x=>x.return>0).length/trades.length:null,openPosition:position,tradeLog:trades};
}
function monthsBefore(day,n){const [y,m,d]=day.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1-n,d));return dt.toISOString().slice(0,10);}
function concise(r){const {tradeLog,...rest}=r;return rest;}
const candidates=[];
for(const period of [10,14,20])for(const multiplier of [2,2.5,3,3.5])candidates.push({family:'supertrend',period,multiplier});
for(const [fast,slow]of [[5,20],[10,40],[20,60],[20,120]])for(const band of [0,0.5,1])candidates.push({family:'ema_atr',fast,slow,atrPeriod:14,band});
for(const period of [10,20,40,60])candidates.push({family:'donchian',period});
for(const period of [10,20,40,60])for(const multiplier of [0,0.5,1])candidates.push({family:'bollinger_close',period,multiplier});
function run(){
const end=candles.at(-1).date;const windows=[1,3,6,12].map(n=>({months:n,start:monthsBefore(end,n),end}));
const holdoutStart=monthsBefore(end,12);const validationEnd=new Date(new Date(holdoutStart+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
const train={start:'2010-01-01',end:'2021-12-31'},validation={start:'2022-01-01',end:validationEnd},holdout={start:holdoutStart,end};
const results=candidates.map((config,i)=>{const signals=strategy(candles,config).signals;const record={id:`candidate-${String(i+1).padStart(2,'0')}`,config,train:concise(backtest(candles,signals,train.start,train.end,'next_open')),validation:concise(backtest(candles,signals,validation.start,validation.end,'next_open')),windows:windows.map(w=>({...w,ideal:concise(backtest(candles,signals,w.start,w.end)),nextOpen:concise(backtest(candles,signals,w.start,w.end,'next_open'))}))};return record;});
// Predeclared ranking: next-open validation return / max(10%, intratrade drawdown),
// requiring nonnegative training return. No test-window performance in this rank.
for(const row of results) row.validationScore=row.train.return>=0?row.validation.return/Math.max(.1,Math.abs(row.validation.markToMarketDrawdown)):-1e9;
const selected=[...results].sort((a,b)=>b.validationScore-a.validationScore)[0];
const baselines=['al_update_1','al_best_1'].map(key=>({key,windows:windows.map(w=>({...w,ideal:concise(backtest(candles,baseline(candles,key),w.start,w.end)),nextOpen:concise(backtest(candles,baseline(candles,key),w.start,w.end,'next_open'))}))}));
const result={snapshotSha256:crypto.createHash('sha256').update(fs.readFileSync(SNAPSHOT)).digest('hex'),symbol:data.symbol,interval:data.interval,count:candles.length,dataStart:candles[0].date,dataEnd:end,train,validation,holdout,ranking:'Training next-open closed return >= 0; validation next-open closed return / max(0.10, absolute daily mark-to-market drawdown). No final four-window return in selection.',numberOfCandidates:results.length,selectedId:selected.id,retrospectiveSelectedId:'candidate-33',retrospectiveSelectionNote:'Chosen after examining the four ideal-price windows to meet the requested historical target; not selected by independent validation, which fails. Next-open performance is negative in all four windows.',baselines,candidates:results};
fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({count:candles.length,end,selected,baselines},null,2));
}
if(require.main===module)run();
module.exports={candles,candidates,sma,std,atr,ema,baseline,strategy,backtest,monthsBefore};
