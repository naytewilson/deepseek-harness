# @deepseek-ai/dsh-web-firecrawl

[English](README.md) | 中文

基于自托管 [Firecrawl](https://github.com/firecrawl/firecrawl) 的 Harness [web 能力 seam](../web/README.md)（`ctx.web`）实现。插件在两个 seam 注册表中各注册一个 `firecrawl` 提供方：`web_search` 使用 `POST /v1/search`，`web_fetch` 使用 `POST /v1/scrape`。

这是实现包。它不拥有 `ctx.web`，也不注册面向模型的工具；[`dsh-tool-web`](../tool-web/README.md) 仍然是消费方。搜索和抓取共享一个配置好的 Firecrawl 端点，因此一次组合可以把两种能力固定到同一个自托管服务。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `$FIRECRAWL_BASE_URL`，然后是 `http://127.0.0.1:33102` | 自托管 Firecrawl API 根地址，可以带或不带 `/v1` 后缀。无法解析或带有凭据的 URL 会使两个提供方不可用。 |
| `apiKey` | `$FIRECRAWL_API_KEY` | 认证部署的可选 API 密钥。仅发送到已配置的端点，并禁用重定向跟随。 |
| `searchLimit` | `8` | seam 请求未提供 `maxResults` 时的默认搜索结果数。 |
| `maxResponseBytes` | `10000000` | Firecrawl JSON 响应的最大接受大小。 |

```yaml
- id: web
  config:
    searchProvider: firecrawl
    fetchProvider: firecrawl
- insert:
    - id: web-firecrawl
      name: '@deepseek-ai/dsh-web-firecrawl'
      config:
        baseURL: http://127.0.0.1:33102
- id: web-search-deepseek
  disabled: true
- id: tool-web
  config:
    search: true
    fetch: true
```

## 映射

搜索把 `{ query, limit }` 发送到 `/v1/search`。每个带非空 URL 的 Firecrawl 结果会成为 `WebSearchSource`：`url` ← `url`、`title` ← `title`、`snippet` ← `description`（或 `snippet`）、`publishedAt` ← `publishedDate`。重复 URL 会被移除，最终的 `maxResults` 上限由 web seam 执行。

抓取把 `{ url, formats: ['markdown', 'html'], skipTlsVerification: false }` 发送到 `/v1/scrape`。返回的 `data.markdown` 成为 seam 的 `text` 内容，否则 `data.html` 成为 `html` 内容。存在时，`metadata.url` 与 `metadata.statusCode` 携带最终 URL 和源响应状态。显式的 `skipTlsVerification: false` 是适配器契约的一部分，防止上游默认请求不安全模式。

两个提供方请求都使用 `redirect: 'error'`、传递取消信号，并把传输、HTTP、响应封装错误和中止归类为 `WebError`（`WEB_PROVIDER_ERROR` 或 `WEB_ABORTED`）。`available()` 从不发起网络请求。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.md) 间接影响；该工具保留有上限的 Firecrawl 搜索 URL 与摘要，或 Firecrawl Markdown／HTML 抓取内容。提供方不增加额外提示词或面向模型的 schema。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。Firecrawl 结果是独立的辅助 Web 请求。

## 已知限制与暂缓事项

- **配置端点信任**：插件验证管理员提供的 Firecrawl 基址，但不为上游服务增加 SSRF 策略；目标验证由自托管 Firecrawl／适配器部署负责。
- **Firecrawl API 形状**：本包只映射当前的 `/v1/search` 与 `/v1/scrape` 封装；提取、crawl、map、actions 和提供方专属搜索控制不属于提供方无关的 `ctx.web` 契约。
- **响应上限在读取后执行**：包会拒绝声明和解码后超大的响应，但当前实现依赖 Fetch API 读取响应后再检查解码大小；流式上限暂缓。
- **不默认激活**：插件通过显式 patch 提供给 profile；base bundle 继续选择 DeepSeek 提供方，直到部署主动启用自托管 Firecrawl。
