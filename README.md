# ALNEWS · 铝市场研究

基于原版升级的 ALNEWS 2.2。包含 K 线研究、新闻快讯两个主页面，以及手机、电脑安装入口。仓库提供 Render Blueprint 部署配置。

## 使用

Node.js 20 或更新版本（建议 22+），无服务端第三方依赖：

```sh
npm start
```

打开 `http://localhost:8787/`。生产环境通过 HTTPS 访问。环境变量由平台注入，`.env.example` 仅作参考，不会自动加载。

- `/` 或 `/#chart`：行情和 K 线，电脑侧栏布局、手机三品种卡片与底部双页导航。
- `/#news`：国内、国外两个板块各显示最新五条；历史档案可按地域、分类、关键词、起止日期筛选，每页 20 条。
- `/install.html?device=mobile`：手机安装入口。
- `/install.html?device=desktop`：电脑安装入口。

手机与电脑共用同一应用、同一服务端新闻档案，界面按屏幕适配。不是两个独立维护的数据副本，也不是原生 APK/EXE。Android Chrome、桌面 Chrome/Edge 在浏览器允许时可点击安装按钮；iPhone 按 Safari 分享 → 添加到主屏幕 → 添加操作。Mac Safari 可使用添加到程序坞。系统要求的最终安装确认无法省略。

## K 线与策略

图表采用本地随包提供的 Lightweight Charts 5.2.1：拖拽、滚轮/双指缩放、十字光标、成交量副图、MA、深浅图表主题、全屏、日期预设。自动刷新尽量保持当前视野；切换品种/周期/历史范围后重新定位。日线默认请求近 6 个月、视图看最近 90 根；“全部”请求可用全历史。

策略仅保留“铝更新1”“铝-1Best”，新增“铝双轨20（研究）”。删除成交价选择，固定原软件的理想价格：信号当根最低价买入、最高价卖出；不计费用，仅复利统计区间内已平仓收益。旧平均价格偏好自动失效，旧策略信号和已平仓算法保持不变。

新增近1/3/6/12个日历月按钮、三策略四周期对照、按收盘净值计入浮动盈亏的最大回撤。窗口以最新取得K线日期为终点，期初空仓；行情先加载全部可用历史预热指标，图表只显示选定日期，防止短区间因预热不足得到不同信号。历史不足时禁用对应快捷回测并标明缺失，不补造行情。小时线和单月合约不一定有全年数据。

新策略为MA20±0.5倍总体标准差，收盘越上轨转多、越下轨转空、轨内保持方向；不加杠杆、不用日期专属规则。它是40个候选中按最终理想回测结果回顾性筛选的研究候选，仅针对沪铝主连日线研究。截至2026-09-30，最近1/3/6/12个月的理想已平仓收益为1.78%/5.01%/16.22%/47.92%，均高于两个原策略；改用次根开盘成交后均为负收益，更早验证也未通过，因此不能称为实际或未来全面胜出。完整原始数据、全部试验、对照和复现命令见 [研究报告](research/REPORT.md)。图表库不可用时仍回退SVG。

行情每 15/30/60 秒刷新（可选），可见 K 线页面每 60 秒更新。行情来自新浪和 Yahoo；历史数据补充自 `DATA/`。公开行情不保证交易级实时性。仅提供研究功能，不连接交易账户。

## 快讯更新与历史保存

后台启动后立即采集，默认每轮完成后 60 秒再次采集，各来源独立 15 秒超时；接口直接读取归档，不等待外部抓取。前台最新页可见时每 30 秒检查。实时性受源站发布时间、源站缓存、服务可用性影响，不承诺秒级首发。

采集源：SMM 铝/沪铝关键词页结构化 `pubDate`、上期所公告页、Yahoo AA RSS、Alcoa 官方 RSS，以及美联储货币政策与讲话官方 RSS。Alcoa 官方 RSS 在当前开发主机可能返回 403；界面会明确显示异常，其他来源正常更新。LME 公开公告页要求浏览器验证，暂不自动采集；应用保留官方公告链接和未启用状态，不将其计为成功采集源。不会自动破解来源访问挑战，也不生成兜底假新闻。英文原标题保留，详情页原有中文总结/全文翻译仍可用，需要原环境中的 `OPENAI_API_KEY`。

国内/国外按新闻来源归属分组（不是按文章语言或所谈国家判断）：SMM、上期所属于国内；Yahoo、美铝、美联储属于国外。旧档案启动时自动补充地域，不改变原有 ID、发布时间或首次发现时间。每组单独排序取五条，不会因某组更新较多挤占另一组。

按原文 URL 去重，保存标题、链接、来源、正文摘要、真实发布时间、首次/最后发现时间与地域/分类；不保存第三方网页全部内容，不按首页五条截断数据库。不明发布时间的记录保留在历史末尾，不冒充最新。日期筛选与新闻显示统一北京时间。首页“最近检查”不代表文章发布时间。

`NEWS_DATA_DIR` 默认 `./var/news`，全量记录原子写入 `news.json`，程序重启后恢复。只追加/更新已采集记录，无自动按条数或日期清理。档案从新版第一次采集开始积累，无法凭空恢复旧版从未保存的全部历史。首次运行会导入当前公开来源仍提供的记录。来源暂时失败时保留之前内容，并显示状态；损坏归档不会被自动覆盖。

**Render 原免费配置不能满足长期无人值守采集和可靠归档。** 免费实例空闲会休眠，临时文件系统会在重建/部署时丢失；`render.yaml` 保留原免费配置，适合演示。正式使用应采用常驻实例+持久磁盘，准备好的 `render.persistent.yaml` 为收费选项，需先在 Render 确认费用和应用方式。不要仅设置 `NEWS_STORAGE_PERSISTENT=true` 就以为已创建磁盘。

2026-10-04 核对 [Render 定价](https://render.com/pricing)：0.5c-512mb（原 Starter）实例 7 美元/月，1 GB 持久磁盘 0.25 美元/月，基础合计约 7.25 美元/月；超额用量、税费及原有 AI 服务费用另计，以平台确认页面为准。此版本未开通收费资源。

已有 Render 服务应升级为常驻实例、挂载持久磁盘至 `/var/data/alnews`，设置：

```text
NEWS_DATA_DIR=/var/data/alnews
NEWS_STORAGE_PERSISTENT=true
NEWS_POLL_INTERVAL_MS=60000
```

保持现有 `OPENAI_API_KEY` / `OPENAI_MODEL` 等环境变量。部署后验证来源检查时间持续增长、`storage.writable=true` 且 `storage.persistent=true`；重启前后历史数量不应减少。迁移旧的新版归档时，停止旧采集进程再复制完整 `news.json` 到新目录。建议定期备份该文件。当前文件归档方案面向单实例运行，多实例应迁移到共享数据库，不能同时写一个文件。

## 可选付费新闻源

快讯页提供 EODHD 官方套餐选择入口：https://eodhd.com/pricing 。当前仅为外部链接，未开通订阅、未创建或收集 API Key，也不会请求 EODHD 新闻接口。2026-10-04 官方个人套餐参考：含新闻的 EOD Historical All-World 为 19.99 美元/月或 199 美元/年；有低额度免费测试方案。以官方最新报价为准，对外展示需要确认商业授权。未来决定购买后再配置服务端接口，不能把密钥放到前端。

## 接口

- `GET /health`
- `GET /api/quote?product=al`
- `GET /api/kline?symbol=nf_AL0&interval=1d&start=2026-01-01&end=2026-10-04`
- `GET /api/news/latest?limit=5`
- `GET /api/news/history?region=domestic&section=close&q=铝&from=2026-09-01&to=2026-10-04&page=1&pageSize=20`
- `GET /api/news`：保留旧版结构兼容。
- `POST /api/article-summary`：原有文章阅读服务。

新闻新接口返回 `items,total,page,pageSize,hasMore,checkedAt,collecting,sources,storage`；最新接口另返回 `groups.domestic` 与 `groups.international`，每组最多五条、独立总数与分页信息；顶层 `items` 保留旧版全局列表兼容。历史可用 `region=domestic/international` 过滤；`section` 为 `today/close/exchange/alcoa/macro`。`publishedAt` 缺失时为 null，日期精度通过 `timePrecision` 标明。

## 验证

```sh
npm test
```

当前 67 项测试全部通过。回归测试覆盖国内/国外各五条、地域筛选、旧档案地域迁移、免费 RSS 解析与付费链接，及三策略接入、旧规则一致性、四周期研究复现、历史前缀不变性、指标预热、时区和数据排序、视野保持、请求竞态、新闻去重与真实时间、分页筛选、归档重启恢复、来源失败与超时、HTTP 接口、安装与离线缓存行为。HTTP 测试需要允许绑定本机端口。浏览器另验证桌面与 390px/窄屏手机布局、图表、新闻查询和安装引导。真实手机系统安装需在最终 HTTPS 站点上完成，不能由本机尺寸模拟替代。

## 参考与许可

- [Lightweight Charts 官方文档](https://tradingview.github.io/lightweight-charts/docs)
- [Render 免费服务限制](https://render.com/docs/free) 与 [持久磁盘](https://render.com/docs/disks)
- [Apple iPhone 网页应用说明](https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iph42ab2f3a7/ios)
- 图表许可证与归属见 `public/vendor/LICENSE`、`THIRD_PARTY_NOTICES.txt`，图表保持 TradingView 归属链接。
