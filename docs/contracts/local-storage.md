# 本地存储 Schema（桌面端）

> 对应 ADR-005：JSON 文件为主 + SQLite 为辅。禁止使用注册表存放业务配置；禁止硬编码绝对路径。

## 1. 存储路径策略（Tauri v2 标准目录）

| 数据 | 路径 | 格式 |
|------|------|------|
| 应用设置 | `{appConfigDir}/settings.json` | JSON |
| 用户配置档 | `{appConfigDir}/profiles/{id}.json` | JSON（每档一文件） |
| 旧配置导入副本 | `{appConfigDir}/migrated/{原文件名}` | JSON（只读副本，保留原样） |
| 运行时数据库 | `{appDataDir}/hub.db` | SQLite |
| 自定义图标/品牌资源 | `{appDataDir}/assets/` | 文件 |

> 路径通过 Tauri `path` API 解析（`appConfigDir` / `appDataDir`），代码中不得出现 `C:\...` 绝对路径。

## 2. settings.json

```json
{
  "schemaVersion": 1,
  "language": "zh-CN",
  "theme": "system",
  "launchAtStartup": false,
  "startMinimized": false,
  "hideWhenNoDevice": true,
  "deviceVidWhitelist": ["0D8C", "4C4A", "20F8", "0E6A", "046A"],
  "lastConnectedDeviceId": null
}
```

- `deviceVidWhitelist`：对应 ADR-004，运行时枚举过滤条件（可扩展）。
- `theme`：`system | light | dark`（颜色一律走主题令牌，禁止硬编码，见 P0 规则）。

## 3. profiles/{id}.json

结构见 `tauri-commands.md` §4 `Profile`。要点：
- 必带 `schemaVersion`（当前 1），用于后续迁移。
- `source = legacy-import` 时必带 `migratedAt` 与 `migratedFrom`（来源指纹，保证幂等）。
- profile 内容字段可为 null（表示该维度未配置，apply 时不下发）。

## 4. hub.db（SQLite）

仅存需要查询/事务的运行时数据：

```sql
CREATE TABLE IF NOT EXISTS device_history (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL,
  vendor_id    TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  disconnected_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_device_history_device ON device_history(device_id, connected_at);

CREATE TABLE IF NOT EXISTS operation_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  domain     TEXT NOT NULL,          -- device/eq/spatial/led/profile
  command    TEXT NOT NULL,
  channel    TEXT NOT NULL,          -- tier1-sidecar / tier2-rust
  result_code INTEGER NOT NULL,
  detail     TEXT
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key       TEXT PRIMARY KEY,
  enabled   INTEGER NOT NULL DEFAULT 0,
  rollouts  TEXT                     -- JSON: { user_ids?: string[], percentage?: number }
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

## 5. 迁移策略

1. 启动时读取 `schemaVersion`，与代码内 `CURRENT_SCHEMA_VERSION` 比较，逐版本执行迁移脚本（记录到 `schema_migrations`）。
2. **旧配置导入**（`legacy_config_import`）：
   - 逐个读取原版 `UI\Configs\*.json` → 用 `docs/schemas/*.schema.json` 校验 → 转换成新 `Profile`/`settings`。
   - 原文件原样复制到 `{appConfigDir}/migrated/` 作为只读副本。
   - 幂等：以来源指纹（文件名 + 内容 hash）判断，已导入且用户未修改则跳过；用户已修改则不覆盖。
   - 单个文件失败不阻塞整体，计入 `ImportReport.failed`。
3. 原版 ProgramData 根：`Cmedia\CM002X1`（来自 `UI\Path.txt` 的 `ProgramDataRoot`/`ProgramDataProduct` 宏），导入向导应默认探测该目录，但允许用户手动指定。
