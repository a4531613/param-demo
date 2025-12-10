# 动态参数配置数据结构设计

为支持多应用、多环境、多类型的动态参数配置，采用分层、可审计的数据模型。所有表均建议使用统一的审计字段：`created_by`、`created_at`、`updated_by`、`updated_at`、`is_enabled`（是否启用）、`is_deleted`（逻辑删除标记）。下表仅列出业务字段，审计字段默认包含。

## 总体关系
- **应用** 下包含多个 **环境**，同一应用的环境可共享或独立配置类型。
- **配置类型** 定义字段模板，**配置版本** 绑定具体的环境与类型，并在 **数据配置** 中填充字段值。
- **用户** 产生 **审计日志**，日志可追溯到任一目标实体。
- 建议以「应用 + 环境 + 类型 + 版本 + 字段」形成树状层级，便于做权限与审批切分。

## 1. 应用管理（applications）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| app_id | bigint | PK | 应用唯一标识 |
| app_code | varchar(64) | UNIQUE | 应用编码，便于调用方引用 |
| app_name | varchar(128) | NOT NULL | 应用名称 |
| description | text |  | 描述 |

> 启用/禁用通过 `is_enabled` 控制。

## 2. 环境管理（environments）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| env_id | bigint | PK | 环境唯一标识 |
| env_code | varchar(64) | UNIQUE | 环境编码（如 `dev`、`test`、`prod`） |
| env_name | varchar(128) | NOT NULL | 环境名称 |
| app_id | bigint | FK → applications.app_id | 所属应用 |
| description | text |  | 描述 |

> 可按应用拆分环境；同一编码在同一应用下唯一。

## 3. 配置类型管理（config_types）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| type_id | bigint | PK | 类型标识 |
| type_code | varchar(64) | UNIQUE (app_id, env_id) | 类型编码（如 `db`, `redis`） |
| type_name | varchar(128) | NOT NULL | 类型名称 |
| app_id | bigint | FK | 所属应用 |
| env_id | bigint | FK | 所属环境 |
| description | text |  | 描述 |

> 类型编码在应用+环境下唯一，便于查找。

## 4. 配置类型字段管理（config_type_fields）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| field_id | bigint | PK | 字段标识 |
| field_key | varchar(64) | UNIQUE (type_id) | 字段标识键 |
| field_name | varchar(128) | NOT NULL | 字段名称 |
| field_type | varchar(32) | NOT NULL | 字段数据类型（string/int/boolean/json/secret 等） |
| field_length | int |  | 可选长度限制 |
| is_required | boolean | default false | 是否必填 |
| regex_pattern | varchar(256) |  | 可选正则约束 |
| type_id | bigint | FK → config_types.type_id | 所属类型 |
| description | text |  | 描述 |

> 可扩展 `default_value`、`enum_options`（json 数组）以支持默认值或枚举校验。

## 5. 版本管理（config_versions）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| version_id | bigint | PK | 版本标识 |
| version_no | varchar(64) | UNIQUE (app_id, env_id, type_id) | 版本号（如 `2024.05.01-1`） |
| app_id | bigint | FK | 应用 |
| env_id | bigint | FK | 环境 |
| type_id | bigint | FK | 配置类型 |
| effective_from | timestamp | NOT NULL | 生效时间 |
| effective_to | timestamp |  | 失效时间/结束时间（可为空表示当前最新） |
| description | text |  | 描述 |

> 建议设置 `is_current` 标志或通过 `effective_to IS NULL` 判断当前版本；也可引入基于时间的版本切换。

## 6. 数据配置（config_items）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| item_id | bigint | PK | 数据记录标识 |
| app_id | bigint | FK | 应用 |
| env_id | bigint | FK | 环境 |
| type_id | bigint | FK | 配置类型 |
| version_id | bigint | FK → config_versions.version_id | 归属版本 |
| field_id | bigint | FK → config_type_fields.field_id | 字段定义 |
| field_key | varchar(64) | NOT NULL | 冗余字段键，便于按键查询 |
| field_value | text | NOT NULL | 配置值（可存加密密文） |
| value_format | varchar(32) | default 'plain' | 值格式：plain/json/yaml/secret |
| description | text |  | 描述 |

> `field_value` 可根据 `field_type` 做强校验；密钥型字段应支持加密存储并在读取时解密。
> 同一 `version_id` 下 `(field_id)` 或 `(field_key)` 应唯一，以避免同一字段重复写入。

### 字段类型参考
| 字段类型 | 存储形式 | 校验建议 |
| --- | --- | --- |
| string | varchar/text | 长度、正则 |
| int/long | bigint/int | 数值范围 |
| boolean | boolean | 仅 true/false |
| json | jsonb | JSON Schema 校验 |
| yaml | text | 解析验证后转存 jsonb |
| secret | text | 入库加密、读取解密 |

## 7. 用户管理（users）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| user_id | bigint | PK | 用户标识 |
| username | varchar(64) | UNIQUE | 登录账号 |
| password_hash | varchar(256) | NOT NULL | 密码哈希（避免明文） |
| display_name | varchar(128) |  | 展示名称 |
| description | text |  | 描述 |
| is_admin | boolean | default false | 是否管理员 |

> 建议补充 `email`、`phone`、`status`、`last_login_at`，以及基于 RBAC 的角色、权限表。

## 8. 审计日志（audit_logs）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| log_id | bigint | PK | 审计标识 |
| actor_id | bigint | FK → users.user_id | 操作人 |
| action | varchar(64) | NOT NULL | 操作类型（create/update/delete/publish 等） |
| target_type | varchar(64) | NOT NULL | 目标实体（application/environment/type/field/version/item） |
| target_id | bigint | NOT NULL | 目标实体 ID |
| before_snapshot | jsonb |  | 变更前快照 |
| after_snapshot | jsonb |  | 变更后快照 |
| request_id | varchar(128) |  | 追踪链路 ID |
| ip | varchar(64) |  | 请求来源 |
| remark | text |  | 备注 |
| occurred_at | timestamp | default now | 发生时间（可独立于 created_at） |

## 推荐索引
- `config_versions`: `(app_id, env_id, type_id, is_enabled, is_deleted, effective_from DESC)`
- `config_items`: `(app_id, env_id, type_id, version_id, field_key)`、`(field_id)`
- `audit_logs`: `(target_type, target_id, occurred_at DESC)`

> 可根据业务情况补充唯一约束：例如在 `config_items` 上添加 `(version_id, field_key)` 唯一键，避免同一版本同一字段被重复写入。

## DDL 草案（PostgreSQL 示例）
以下片段示例展示核心约束写法，可按需扩展审计字段与更多索引。

```sql
CREATE TABLE config_versions (
  version_id   BIGSERIAL PRIMARY KEY,
  version_no   VARCHAR(64) NOT NULL,
  app_id       BIGINT NOT NULL REFERENCES applications(app_id),
  env_id       BIGINT NOT NULL REFERENCES environments(env_id),
  type_id      BIGINT NOT NULL REFERENCES config_types(type_id),
  effective_from TIMESTAMP NOT NULL,
  effective_to   TIMESTAMP,
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_versions UNIQUE (app_id, env_id, type_id, version_no)
);

CREATE TABLE config_items (
  item_id     BIGSERIAL PRIMARY KEY,
  app_id      BIGINT NOT NULL REFERENCES applications(app_id),
  env_id      BIGINT NOT NULL REFERENCES environments(env_id),
  type_id     BIGINT NOT NULL REFERENCES config_types(type_id),
  version_id  BIGINT NOT NULL REFERENCES config_versions(version_id),
  field_id    BIGINT NOT NULL REFERENCES config_type_fields(field_id),
  field_key   VARCHAR(64) NOT NULL,
  field_value TEXT NOT NULL,
  value_format VARCHAR(32) NOT NULL DEFAULT 'plain',
  is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_item_field UNIQUE (version_id, field_id),
  CONSTRAINT uq_item_field_key UNIQUE (version_id, field_key)
);
```

## 使用示例（JSON 片段）
```json
{
  "appCode": "billing",
  "envCode": "prod",
  "typeCode": "mysql",
  "versionNo": "2024.06.01-1",
  "items": [
    { "fieldKey": "host", "value": "10.0.0.12" },
    { "fieldKey": "port", "value": 3306 },
    { "fieldKey": "username", "value": "svc_billing" },
    { "fieldKey": "password", "value": "enc:BASE64...", "valueFormat": "secret" }
  ]
}
```

## 约束与校验建议
- 在字段层面落库前执行类型校验、正则校验以及必填校验。
- 字段类型如为 `json`/`yaml`，可通过 JSON Schema 进行结构校验；密钥字段可在入库时加密。
- 版本发布时，生成不可变的配置快照并与审计日志关联，确保回溯能力。
- 针对 `is_enabled` 和 `effective_to` 可设置唯一约束，保证同一类型在同一时间仅有一个有效版本。
