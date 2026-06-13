# 多维表平台 V2.0 功能增强 SPEC：多表、表关联、彩色下拉、AI确认式执行

Version: 2.0  
Status: Ready For Codex Development  
Target: 类飞书多维表 / Airtable / 钉钉 AI 表格的多维表应用平台  

---

## 0. 本文档目标

本文档用于指导 Codex 直接开发当前多维表平台 V2.0。

本次升级在已有基础表格能力之上，新增：

1. 一个应用下支持多个表格；
2. 表格与表格之间支持字段关联；
3. 下拉字段选项支持颜色；
4. AI 助理升级为“先规划、再确认、后执行”；
5. 给出底层数据库模型、接口设计、前端组件结构、AI Tool Schema、执行状态机、验收标准。

---

## 1. 当前系统假设

当前系统已经具备：

- 应用 App；
- 表格 Table；
- 字段 Field；
- 记录 Record；
- 基础表格展示；
- 新增、编辑、删除记录；
- 基础 AI 创建表格能力；
- 右下角 AI 助理入口。

当前页面形态类似：

```text
应用名称 / 当前表格

左侧：页面 / 表格导航
中间：表格数据区
顶部：视图、筛选、排序、分组、字段设置、导出
右下角：AI 助理
```

---

## 2. 本次升级总目标

系统从“单表表格工具”升级为“多表应用构建平台”。

目标形态：

```text
一个应用 App
  ├── 表格 A：商品表
  ├── 表格 B：分类表
  ├── 表格 C：供应商表
  ├── 表格 D：订单表
  └── 表格 E：库存流水表
```

AI 助理不再直接执行用户指令，而是采用：

```text
用户提出需求
  ↓
AI 输出结构化方案
  ↓
用户确认或修改
  ↓
用户确认后 AI 执行
  ↓
系统创建表、字段、关联关系、视图
```

---

## 3. 核心功能范围

### 3.1 Feature-01：一个应用支持多个表格

每个 App 下可以创建多个 Table。

示例：

```text
联系人通讯录
  ├── 联系人表
  ├── 公司表
  ├── 标签表
  └── 跟进记录表
```

### 3.2 Feature-02：表与表之间支持关联字段

示例：

```text
A 表：商品表
字段：商品名称、商品分类

B 表：分类表
字段：分类名称

A 表的“商品分类”字段关联 B 表的“分类名称”字段。
```

新增或编辑商品时，“商品分类”可以从分类表的分类名称中下拉选择。

### 3.3 Feature-03：下拉字段选项支持颜色

示例：

```text
状态字段：
- 未开始：灰色
- 进行中：蓝色
- 已完成：绿色
- 已取消：红色
```

表格中显示为彩色 Tag。

### 3.4 Feature-04：AI 助理升级为确认式执行

AI 必须先输出方案，不得直接执行。

用户确认后，AI 才能调用工具创建应用、表格、字段、关联关系。

---

## 4. 数据库底层设计

以下设计优先兼容 PostgreSQL。若当前项目使用 SQLite / MySQL，也可以保持相同结构做适配。

---

## 4.1 app：应用表

```sql
CREATE TABLE apps (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

说明：

- 一个 App 是一个业务应用，例如“联系人通讯录”“商品管理系统”“CRM 系统”；
- 一个 App 下包含多个数据表。

---

## 4.2 app_tables：数据表定义表

```sql
CREATE TABLE app_tables (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(255),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_app_tables_app_id ON app_tables(app_id);
```

说明：

- 一个 app_id 下允许多个 table；
- sort_order 用于左侧表格排序；
- 删除 App 时，其下表格一起删除。

---

## 4.3 app_fields：字段定义表

```sql
CREATE TABLE app_fields (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES app_tables(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_app_fields_table_id ON app_fields(table_id);
CREATE INDEX idx_app_fields_app_id ON app_fields(app_id);
```

字段类型 type 支持：

```text
text
long_text
number
currency
percent
date
datetime
checkbox
select
multi_select
relation
lookup
rollup
formula
attachment
user
created_time
updated_time
```

本版本必须实现：

```text
text
number
date
checkbox
select
multi_select
relation
```

lookup、rollup、formula 可先预留字段类型，V2.1 再完整实现。

---

## 4.4 app_records：记录主表

```sql
CREATE TABLE app_records (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES app_tables(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    deleted_at TIMESTAMP
);

CREATE INDEX idx_app_records_table_id ON app_records(table_id);
CREATE INDEX idx_app_records_app_id ON app_records(app_id);
CREATE INDEX idx_app_records_deleted_at ON app_records(deleted_at);
```

说明：

- 记录主体单独存储；
- 字段值存储在 app_record_values；
- deleted_at 用于软删除。

---

## 4.5 app_record_values：记录字段值表

```sql
CREATE TABLE app_record_values (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES app_tables(id) ON DELETE CASCADE,
    record_id UUID NOT NULL REFERENCES app_records(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES app_fields(id) ON DELETE CASCADE,
    value JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(record_id, field_id)
);

CREATE INDEX idx_record_values_record_id ON app_record_values(record_id);
CREATE INDEX idx_record_values_field_id ON app_record_values(field_id);
CREATE INDEX idx_record_values_table_id ON app_record_values(table_id);
```

说明：

- 所有普通字段值统一以 JSONB 存储；
- text 存 `{ "text": "张三" }`；
- number 存 `{ "number": 123 }`；
- select 存 `{ "optionId": "xxx" }`；
- multi_select 存 `{ "optionIds": ["xxx", "yyy"] }`；
- relation 不建议直接存在这里，而是存在 app_record_relations。

---

## 4.6 app_record_relations：记录关联关系表

```sql
CREATE TABLE app_record_relations (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    source_table_id UUID NOT NULL REFERENCES app_tables(id) ON DELETE CASCADE,
    source_record_id UUID NOT NULL REFERENCES app_records(id) ON DELETE CASCADE,
    relation_field_id UUID NOT NULL REFERENCES app_fields(id) ON DELETE CASCADE,
    target_table_id UUID NOT NULL REFERENCES app_tables(id) ON DELETE CASCADE,
    target_record_id UUID NOT NULL REFERENCES app_records(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_record_id, relation_field_id, target_record_id)
);

CREATE INDEX idx_rel_source_record ON app_record_relations(source_record_id);
CREATE INDEX idx_rel_target_record ON app_record_relations(target_record_id);
CREATE INDEX idx_rel_field ON app_record_relations(relation_field_id);
CREATE INDEX idx_rel_target_table ON app_record_relations(target_table_id);
```

说明：

- 关联字段使用独立表存储，方便查询、统计、反向引用；
- 支持单选关联与多选关联；
- 单选关联通过业务逻辑限制同一个 source_record_id + relation_field_id 只能有一条记录；
- 多选关联允许多条 target_record_id。

---

## 4.7 app_views：视图表

```sql
CREATE TABLE app_views (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES app_tables(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'grid',
    config JSONB NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_app_views_table_id ON app_views(table_id);
```

视图类型预留：

```text
grid
kanban
calendar
gallery
form
gantt
```

本版本只要求 grid。

---

## 4.8 ai_sessions：AI 会话表

```sql
CREATE TABLE ai_sessions (
    id UUID PRIMARY KEY,
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'idle',
    current_plan JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

status 支持：

```text
idle
planning
waiting_confirmation
executing
completed
failed
cancelled
```

---

## 4.9 ai_messages：AI 聊天消息表

```sql
CREATE TABLE ai_messages (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    content TEXT,
    structured_content JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_messages_session_id ON ai_messages(session_id);
```

role 支持：

```text
user
assistant
system
tool
```

---

## 4.10 ai_execution_logs：AI 执行日志表

```sql
CREATE TABLE ai_execution_logs (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    step_name VARCHAR(255) NOT NULL,
    tool_name VARCHAR(255),
    status VARCHAR(50) NOT NULL,
    input JSONB,
    output JSONB,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_execution_logs_session_id ON ai_execution_logs(session_id);
```

status 支持：

```text
pending
running
success
failed
skipped
```

---

# 5. 字段 config 结构设计

## 5.1 text 字段

```json
{
  "placeholder": "请输入文本",
  "maxLength": 255
}
```

## 5.2 number 字段

```json
{
  "precision": 2,
  "min": null,
  "max": null
}
```

## 5.3 select 字段

```json
{
  "options": [
    {
      "id": "opt_todo",
      "label": "未开始",
      "color": "gray"
    },
    {
      "id": "opt_doing",
      "label": "进行中",
      "color": "blue"
    },
    {
      "id": "opt_done",
      "label": "已完成",
      "color": "green"
    }
  ]
}
```

## 5.4 multi_select 字段

```json
{
  "options": [
    {
      "id": "opt_vip",
      "label": "VIP",
      "color": "purple"
    },
    {
      "id": "opt_key",
      "label": "重点客户",
      "color": "orange"
    }
  ]
}
```

## 5.5 relation 字段

```json
{
  "targetTableId": "table_category",
  "displayFieldId": "field_category_name",
  "multiple": false,
  "allowCreateTargetRecord": false,
  "enableSearch": true
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| targetTableId | 被关联的目标表 |
| displayFieldId | 下拉展示时显示目标表的哪个字段 |
| multiple | 是否允许多选 |
| allowCreateTargetRecord | 下拉中是否允许快速新增目标记录 |
| enableSearch | 是否支持搜索 |

---

# 6. 记录值存储格式

## 6.1 text

```json
{
  "text": "张三"
}
```

## 6.2 number

```json
{
  "number": 99.5
}
```

## 6.3 date

```json
{
  "date": "2026-06-12"
}
```

## 6.4 checkbox

```json
{
  "checked": true
}
```

## 6.5 select

```json
{
  "optionId": "opt_doing"
}
```

## 6.6 multi_select

```json
{
  "optionIds": ["opt_vip", "opt_key"]
}
```

## 6.7 relation

relation 字段值不存入 app_record_values，而是存入 app_record_relations。

单选关联示例：

```json
{
  "sourceRecordId": "record_product_1",
  "relationFieldId": "field_product_category",
  "targetRecordId": "record_category_phone"
}
```

多选关联示例：

```json
[
  {
    "sourceRecordId": "record_customer_1",
    "relationFieldId": "field_customer_tags",
    "targetRecordId": "record_tag_vip"
  },
  {
    "sourceRecordId": "record_customer_1",
    "relationFieldId": "field_customer_tags",
    "targetRecordId": "record_tag_key"
  }
]
```

---

# 7. 后端 API 设计

以下路径可按当前项目风格调整，例如 `/api/apps` 或 `/api/v1/apps`。

---

## 7.1 应用 API

### 创建应用

```http
POST /api/apps
```

Request:

```json
{
  "name": "商品管理系统",
  "description": "管理商品、分类、供应商和库存"
}
```

Response:

```json
{
  "id": "app_xxx",
  "name": "商品管理系统"
}
```

### 获取应用详情

```http
GET /api/apps/:appId
```

### 获取应用下所有表

```http
GET /api/apps/:appId/tables
```

---

## 7.2 表格 API

### 创建表格

```http
POST /api/apps/:appId/tables
```

Request:

```json
{
  "name": "商品表",
  "description": "商品基础信息表",
  "icon": "box"
}
```

### 修改表格

```http
PATCH /api/tables/:tableId
```

### 删除表格

```http
DELETE /api/tables/:tableId
```

删除表格时必须：

1. 检查是否有其他字段关联该表；
2. 如果存在关联，返回 warning；
3. 前端提示用户确认；
4. 确认后再级联删除。

---

## 7.3 字段 API

### 获取字段列表

```http
GET /api/tables/:tableId/fields
```

### 创建字段

```http
POST /api/tables/:tableId/fields
```

Request 示例：创建 relation 字段

```json
{
  "name": "商品分类",
  "type": "relation",
  "config": {
    "targetTableId": "table_category",
    "displayFieldId": "field_category_name",
    "multiple": false,
    "allowCreateTargetRecord": false,
    "enableSearch": true
  }
}
```

### 修改字段

```http
PATCH /api/fields/:fieldId
```

### 删除字段

```http
DELETE /api/fields/:fieldId
```

---

## 7.4 记录 API

### 获取表格记录

```http
GET /api/tables/:tableId/records
```

Query 参数：

```text
viewId
page
pageSize
search
sort
filter
```

Response:

```json
{
  "records": [
    {
      "id": "record_1",
      "values": {
        "field_name": {
          "text": "iPhone"
        },
        "field_price": {
          "number": 5999
        },
        "field_status": {
          "optionId": "opt_on_sale"
        },
        "field_category": {
          "relations": [
            {
              "targetRecordId": "record_category_phone",
              "displayValue": "手机"
            }
          ]
        }
      }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 100
  }
}
```

### 创建记录

```http
POST /api/tables/:tableId/records
```

Request:

```json
{
  "values": {
    "field_name": {
      "text": "iPhone"
    },
    "field_price": {
      "number": 5999
    },
    "field_category": {
      "targetRecordIds": ["record_category_phone"]
    }
  }
}
```

### 修改记录

```http
PATCH /api/records/:recordId
```

### 删除记录

```http
DELETE /api/records/:recordId
```

---

## 7.5 关联字段 API

### 搜索可关联记录

```http
GET /api/fields/:fieldId/relation-options?keyword=手机
```

Response:

```json
{
  "options": [
    {
      "recordId": "record_category_phone",
      "displayValue": "手机"
    },
    {
      "recordId": "record_category_accessory",
      "displayValue": "手机配件"
    }
  ]
}
```

### 获取某条记录的关联值

```http
GET /api/records/:recordId/relations/:fieldId
```

### 更新某条记录的关联值

```http
PUT /api/records/:recordId/relations/:fieldId
```

Request:

```json
{
  "targetRecordIds": ["record_category_phone"]
}
```

后端逻辑：

1. 获取 relation 字段 config；
2. 如果 multiple=false，targetRecordIds 长度不能大于 1；
3. 删除旧关联；
4. 写入新关联；
5. 返回新的展示值。

---

# 8. 表关联底层实现方案

## 8.1 关联字段创建流程

用户创建字段：

```text
字段名：商品分类
字段类型：关联字段
关联表：分类表
显示字段：分类名称
是否多选：否
```

系统写入 app_fields：

```json
{
  "name": "商品分类",
  "type": "relation",
  "config": {
    "targetTableId": "table_category",
    "displayFieldId": "field_category_name",
    "multiple": false,
    "allowCreateTargetRecord": false,
    "enableSearch": true
  }
}
```

---

## 8.2 关联字段渲染流程

表格加载时：

1. 获取当前表字段列表；
2. 发现字段 type = relation；
3. 读取字段 config.targetTableId；
4. 读取 config.displayFieldId；
5. 加载当前页记录的 relation 数据；
6. 将 targetRecordId 转换为 displayValue；
7. 在单元格中显示为 Tag 或文本。

---

## 8.3 编辑关联字段流程

用户点击商品表中“商品分类”单元格：

1. 前端打开 RelationSelect 组件；
2. 调用 `/api/fields/:fieldId/relation-options`；
3. 后端从目标表读取记录；
4. 根据 displayFieldId 获取展示文本；
5. 用户选择目标记录；
6. 前端调用 `/api/records/:recordId/relations/:fieldId`；
7. 后端更新 app_record_relations；
8. 前端刷新当前单元格。

---

## 8.4 删除目标记录时的处理

如果用户删除分类表中的“手机”，但商品表中有 12 个商品引用了它，系统必须提示：

```text
当前记录已被 12 条记录引用，删除后这些关联字段将变为空。是否继续？
```

后端删除流程：

1. 查询 app_record_relations 中 target_record_id = 当前记录 id 的数量；
2. 如果数量大于 0 且未传 force=true，则返回 409；
3. 前端弹出确认框；
4. 用户确认后调用 DELETE `/api/records/:recordId?force=true`；
5. 后端删除记录，同时删除相关 relation 记录。

---

## 8.5 单选与多选规则

### 单选 relation

multiple=false。

保存时：

```text
同一个 source_record_id + relation_field_id 最多一条 target_record_id
```

### 多选 relation

multiple=true。

保存时：

```text
同一个 source_record_id + relation_field_id 可以有多条 target_record_id
```

---

# 9. 彩色下拉字段底层实现方案

## 9.1 select 字段配置

字段定义：

```json
{
  "name": "状态",
  "type": "select",
  "config": {
    "options": [
      {
        "id": "opt_1",
        "label": "未开始",
        "color": "gray"
      },
      {
        "id": "opt_2",
        "label": "进行中",
        "color": "blue"
      },
      {
        "id": "opt_3",
        "label": "已完成",
        "color": "green"
      }
    ]
  }
}
```

记录值：

```json
{
  "optionId": "opt_2"
}
```

表格展示时：

1. 读取 value.optionId；
2. 到 field.config.options 中匹配 option；
3. 渲染 option.label；
4. 使用 option.color 渲染 Tag 样式。

---

## 9.2 multi_select 字段配置

记录值：

```json
{
  "optionIds": ["opt_vip", "opt_key"]
}
```

展示时渲染多个 Tag。

---

## 9.3 颜色枚举

V2 固定颜色库：

```typescript
export const SELECT_COLORS = [
  'gray',
  'blue',
  'green',
  'red',
  'orange',
  'yellow',
  'purple',
  'cyan',
  'pink'
] as const;
```

前端样式建议：

```typescript
export const SELECT_COLOR_STYLES = {
  gray: 'bg-gray-100 text-gray-700 border-gray-200',
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  green: 'bg-green-100 text-green-700 border-green-200',
  red: 'bg-red-100 text-red-700 border-red-200',
  orange: 'bg-orange-100 text-orange-700 border-orange-200',
  yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  purple: 'bg-purple-100 text-purple-700 border-purple-200',
  cyan: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  pink: 'bg-pink-100 text-pink-700 border-pink-200'
};
```

---

## 9.4 修改选项颜色

用户在字段设置中修改颜色：

1. 前端更新 field.config.options；
2. 调用 PATCH `/api/fields/:fieldId`；
3. 后端保存 config；
4. 前端刷新当前表格；
5. 已有记录无需修改，因为记录中只存 optionId。

---

# 10. AI 助理 V2 底层实现方案

## 10.1 AI 助理核心原则

AI 不允许直接写数据库。

AI 只能做两件事：

1. 生成结构化方案 Plan；
2. 在用户确认后调用 Tool 执行。

必须禁止：

```text
用户一说创建，AI 立即创建表格。
```

必须实现：

```text
用户需求 → AI 方案 → 用户确认 → AI 执行
```

---

## 10.2 AI 状态机

```text
idle
  ↓
planning
  ↓
waiting_confirmation
  ↓
executing
  ↓
completed
```

异常状态：

```text
failed
cancelled
```

状态说明：

| 状态 | 说明 |
|---|---|
| idle | 空闲 |
| planning | 正在生成方案 |
| waiting_confirmation | 等待用户确认 |
| executing | 正在执行工具调用 |
| completed | 执行完成 |
| failed | 执行失败 |
| cancelled | 用户取消 |

---

## 10.3 AI Plan JSON Schema

AI 规划阶段必须输出以下结构：

```json
{
  "type": "app_creation_plan",
  "appName": "商品管理系统",
  "description": "用于管理商品、分类、供应商和库存",
  "tables": [
    {
      "tempId": "table_product",
      "name": "商品表",
      "description": "存储商品基础信息",
      "fields": [
        {
          "tempId": "field_product_name",
          "name": "商品名称",
          "type": "text",
          "required": true,
          "config": {}
        },
        {
          "tempId": "field_product_status",
          "name": "状态",
          "type": "select",
          "required": false,
          "config": {
            "options": [
              {
                "id": "opt_on_sale",
                "label": "在售",
                "color": "green"
              },
              {
                "id": "opt_off_sale",
                "label": "停售",
                "color": "gray"
              }
            ]
          }
        }
      ]
    },
    {
      "tempId": "table_category",
      "name": "分类表",
      "description": "存储商品分类",
      "fields": [
        {
          "tempId": "field_category_name",
          "name": "分类名称",
          "type": "text",
          "required": true,
          "config": {}
        }
      ]
    }
  ],
  "relations": [
    {
      "sourceTableTempId": "table_product",
      "fieldName": "商品分类",
      "targetTableTempId": "table_category",
      "targetDisplayFieldTempId": "field_category_name",
      "multiple": false
    }
  ],
  "views": [
    {
      "tableTempId": "table_product",
      "name": "全部商品",
      "type": "grid"
    }
  ]
}
```

---

## 10.4 AI Plan 校验规则

后端收到 AI Plan 后必须校验：

1. appName 不为空；
2. tables 至少 1 个；
3. 每个 table.name 不为空；
4. 每个 field.name 不为空；
5. 每个 field.type 必须在允许枚举中；
6. relation.sourceTableTempId 必须存在；
7. relation.targetTableTempId 必须存在；
8. relation.targetDisplayFieldTempId 必须存在；
9. select / multi_select 的 options 必须有 id、label、color；
10. color 必须属于系统颜色枚举。

如果校验失败，AI 需要重新生成方案，不允许执行。

---

## 10.5 AI Tool Schema

### create_app

```json
{
  "name": "create_app",
  "description": "创建一个应用",
  "parameters": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string"
      },
      "description": {
        "type": "string"
      },
      "icon": {
        "type": "string"
      }
    },
    "required": ["name"]
  }
}
```

### create_table

```json
{
  "name": "create_table",
  "description": "在指定应用下创建数据表",
  "parameters": {
    "type": "object",
    "properties": {
      "appId": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "description": {
        "type": "string"
      },
      "icon": {
        "type": "string"
      }
    },
    "required": ["appId", "name"]
  }
}
```

### create_field

```json
{
  "name": "create_field",
  "description": "在指定表格中创建字段",
  "parameters": {
    "type": "object",
    "properties": {
      "appId": {
        "type": "string"
      },
      "tableId": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "type": {
        "type": "string",
        "enum": [
          "text",
          "long_text",
          "number",
          "currency",
          "percent",
          "date",
          "datetime",
          "checkbox",
          "select",
          "multi_select",
          "relation"
        ]
      },
      "required": {
        "type": "boolean"
      },
      "config": {
        "type": "object"
      }
    },
    "required": ["appId", "tableId", "name", "type"]
  }
}
```

### create_relation_field

```json
{
  "name": "create_relation_field",
  "description": "创建关联字段",
  "parameters": {
    "type": "object",
    "properties": {
      "appId": {
        "type": "string"
      },
      "sourceTableId": {
        "type": "string"
      },
      "fieldName": {
        "type": "string"
      },
      "targetTableId": {
        "type": "string"
      },
      "displayFieldId": {
        "type": "string"
      },
      "multiple": {
        "type": "boolean"
      }
    },
    "required": [
      "appId",
      "sourceTableId",
      "fieldName",
      "targetTableId",
      "displayFieldId"
    ]
  }
}
```

### create_view

```json
{
  "name": "create_view",
  "description": "创建表格视图",
  "parameters": {
    "type": "object",
    "properties": {
      "appId": {
        "type": "string"
      },
      "tableId": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "type": {
        "type": "string",
        "enum": ["grid"]
      },
      "config": {
        "type": "object"
      }
    },
    "required": ["appId", "tableId", "name", "type"]
  }
}
```

---

## 10.6 AI 执行器设计

后端实现 `executePlan(plan)`。

执行顺序：

```text
1. 创建 App，获得真实 appId
2. 创建所有 Table，记录 tempTableId → realTableId 映射
3. 创建所有普通 Field，记录 tempFieldId → realFieldId 映射
4. 创建所有 Relation Field
5. 创建默认 View
6. 返回执行结果
```

伪代码：

```typescript
async function executePlan(plan) {
  const idMap = {
    tables: {},
    fields: {}
  };

  const app = await createApp({
    name: plan.appName,
    description: plan.description
  });

  for (const table of plan.tables) {
    const createdTable = await createTable({
      appId: app.id,
      name: table.name,
      description: table.description
    });
    idMap.tables[table.tempId] = createdTable.id;
  }

  for (const table of plan.tables) {
    const tableId = idMap.tables[table.tempId];

    for (const field of table.fields) {
      if (field.type === 'relation') continue;

      const createdField = await createField({
        appId: app.id,
        tableId,
        name: field.name,
        type: field.type,
        required: field.required,
        config: field.config || {}
      });

      idMap.fields[field.tempId] = createdField.id;
    }
  }

  for (const relation of plan.relations || []) {
    const sourceTableId = idMap.tables[relation.sourceTableTempId];
    const targetTableId = idMap.tables[relation.targetTableTempId];
    const displayFieldId = idMap.fields[relation.targetDisplayFieldTempId];

    await createRelationField({
      appId: app.id,
      sourceTableId,
      fieldName: relation.fieldName,
      targetTableId,
      displayFieldId,
      multiple: relation.multiple || false
    });
  }

  for (const view of plan.views || []) {
    await createView({
      appId: app.id,
      tableId: idMap.tables[view.tableTempId],
      name: view.name,
      type: view.type || 'grid',
      config: view.config || {}
    });
  }

  return {
    appId: app.id,
    idMap
  };
}
```

---

## 10.7 AI 执行事务

AI 执行必须尽量使用数据库事务。

要求：

```text
如果任意步骤失败，回滚整个创建过程。
```

执行器应支持：

```typescript
await db.transaction(async (tx) => {
  await executePlanWithTransaction(tx, plan);
});
```

如果当前数据库层不方便支持事务，至少要实现失败清理：

1. 记录本次创建出来的 appId/tableId/fieldId；
2. 失败时按反向顺序删除；
3. ai_execution_logs 记录失败原因。

---

# 11. 前端组件设计

## 11.1 页面结构

```text
AppLayout
  ├── AppSidebar
  │     ├── AppHeader
  │     ├── TableList
  │     └── CreateTableButton
  │
  ├── TableWorkspace
  │     ├── TableTopbar
  │     ├── ViewTabs
  │     ├── TableToolbar
  │     └── GridView
  │
  └── AIAssistantDrawer
```

---

## 11.2 核心组件

### AppSidebar

功能：

- 展示当前 App；
- 展示 App 下所有表；
- 支持切换表；
- 支持新建表；
- 支持表排序。

### CreateTableModal

功能：

- 空白创建；
- AI 创建；
- 输入表名、描述。

### FieldSettingsPanel

功能：

- 新增字段；
- 修改字段；
- 设置 select 选项颜色；
- 设置 relation 目标表和显示字段。

### RelationFieldEditor

功能：

- 显示目标表记录；
- 支持搜索；
- 支持单选；
- 支持多选；
- 保存 targetRecordIds。

### SelectTag

功能：

- 根据 option.color 渲染彩色标签。

### AIAssistantDrawer

功能：

- 聊天输入；
- 方案展示；
- 修改方案；
- 确认执行；
- 执行进度；
- 执行完成跳转。

---

## 11.3 AI 助理界面流程

### 用户输入

```text
帮我创建一个商品管理系统，包括商品、分类、供应商、库存
```

### AI 返回方案卡片

```text
商品管理系统

将创建：
- 4 张表
- 18 个字段
- 3 个关联关系

[展开查看]
[修改方案]
[确认创建]
```

### 用户修改

```text
增加一个品牌表，商品要关联品牌
```

AI 重新输出方案。

### 用户确认

点击：

```text
确认创建
```

执行区显示：

```text
正在创建应用... √
正在创建商品表... √
正在创建分类表... √
正在创建供应商表... √
正在创建关联字段... √
创建完成
```

---

# 12. 业务规则

## 12.1 多表规则

1. 一个 App 可以创建多个 Table；
2. Table 名称允许重复，但建议前端提醒；
3. 删除 Table 时，如果被其他表关联，需要提示；
4. 默认新表创建后自动创建一个“全部记录”视图。

## 12.2 Relation 规则

1. relation 字段必须指定 targetTableId；
2. relation 字段必须指定 displayFieldId；
3. displayFieldId 必须属于 targetTableId；
4. 单选 relation 只能保存一个 targetRecordId；
5. 多选 relation 可以保存多个 targetRecordId；
6. 删除目标记录时，必须清理 relation 表；
7. 删除 relation 字段时，必须清理对应 app_record_relations。

## 12.3 Select 规则

1. option.id 创建后不得改变；
2. option.label 可以修改；
3. option.color 可以修改；
4. 删除 option 时，如果已有记录使用该 option，前端提示；
5. 导出数据时导出 label，不导出 optionId。

## 12.4 AI 规则

1. AI 必须先给方案；
2. AI 不允许直接执行；
3. 用户确认后才能执行；
4. 用户可以无限次修改方案；
5. 每次修改后都生成新的 current_plan；
6. 执行过程必须记录日志；
7. 执行失败必须提示用户并记录失败步骤。

---

# 13. 数据查询实现建议

## 13.1 查询表格记录

获取表格数据时需要返回：

1. records；
2. fields；
3. select option 配置；
4. relation displayValue。

后端处理步骤：

```text
1. 查询当前 table 的 fields
2. 查询当前 table 的 records
3. 查询 records 对应的 app_record_values
4. 查询 relation 字段对应的 app_record_relations
5. 对 relation 的 targetRecordId 批量查询 displayFieldId 的值
6. 拼装为前端可直接渲染的数据结构
```

---

## 13.2 relation displayValue 批量查询

避免 N+1 查询。

错误做法：

```text
每一行、每一个 relation 都单独查一次目标记录
```

正确做法：

```text
1. 收集当前页所有 targetRecordId
2. 收集对应 displayFieldId
3. 一次性查询 app_record_values
4. 在内存中组装 displayValue
```

---

# 14. 导出规则

导出 CSV / Excel 时：

## select

导出 label：

```text
进行中
```

不要导出：

```text
opt_doing
```

## multi_select

导出：

```text
VIP,重点客户
```

## relation

导出 displayValue：

```text
手机
```

多选 relation 导出：

```text
手机,数码配件
```

---

# 15. 权限与安全

本版本可以先使用简单权限。

预留字段：

```text
created_by
updated_by
```

AI 安全要求：

1. AI 不能执行任意 SQL；
2. AI 不能直接写数据库；
3. AI 只能调用白名单 Tool；
4. Tool 参数必须做后端校验；
5. AI Plan 必须做 JSON Schema 校验；
6. 生产环境中必须限制 AI 单次最多创建表数和字段数。

建议限制：

```text
单次 AI 创建最多 20 张表
单张表最多 100 个字段
单次最多 100 个关联关系
```

---

# 16. 性能要求

V2 目标：

```text
一个 App：100 张表
单表：10000 条记录
单页加载：50-100 条记录
普通查询响应：< 500ms
relation 搜索响应：< 300ms
AI 方案生成：< 30s
AI 执行创建：< 10s
```

必须分页加载记录，不允许一次性加载全表。

---

# 17. 验收标准

## 17.1 多表验收

- AC-001：一个应用下可以创建多个表；
- AC-002：左侧导航显示所有表；
- AC-003：点击表名可以切换表格；
- AC-004：新增表后页面无需刷新；
- AC-005：删除表后不影响其他表；
- AC-006：表可以排序。

## 17.2 表关联验收

- AC-101：可以创建 relation 字段；
- AC-102：relation 字段可以选择目标表；
- AC-103：relation 字段可以选择目标显示字段；
- AC-104：新增记录时 relation 字段以下拉方式选择；
- AC-105：relation 下拉支持搜索；
- AC-106：支持单选 relation；
- AC-107：支持多选 relation；
- AC-108：目标表新增记录后，下拉选项实时可选；
- AC-109：删除被引用记录时有提示；
- AC-110：删除 relation 字段时清理对应关系。

## 17.3 彩色下拉验收

- AC-201：select 选项可以设置颜色；
- AC-202：multi_select 选项可以设置颜色；
- AC-203：表格中以彩色 Tag 显示；
- AC-204：修改颜色后已有记录展示自动变化；
- AC-205：导出时导出文字，不导出颜色或 optionId。

## 17.4 AI 助理验收

- AC-301：用户提出创建需求后，AI 先输出方案；
- AC-302：AI 不得未经确认直接执行；
- AC-303：用户可以修改方案；
- AC-304：修改后 AI 重新输出方案；
- AC-305：用户确认后开始执行；
- AC-306：执行过程显示进度；
- AC-307：执行失败显示失败原因；
- AC-308：执行完成后自动进入创建好的应用或表格；
- AC-309：AI 可以生成多表结构；
- AC-310：AI 可以生成 relation 字段；
- AC-311：AI 可以生成带颜色的 select 字段。

---

# 18. 推荐开发顺序

## Phase 1：数据库与多表基础

1. 增加 app_tables；
2. 调整 table 与 app 关系；
3. 左侧导航支持多表；
4. 表切换；
5. 新建/删除/排序表。

## Phase 2：字段 config 标准化

1. 统一 app_fields.config；
2. select/multi_select 改为 options + color；
3. 表格中支持彩色 Tag；
4. 字段设置面板支持颜色设置。

## Phase 3：Relation 字段

1. 新增 relation 字段类型；
2. 新增 app_record_relations；
3. 实现 RelationSelect 组件；
4. 实现 relation-options API；
5. 实现单选/多选；
6. 实现删除引用提示。

## Phase 4：AI 助理 V2

1. 新增 ai_sessions / ai_messages / ai_execution_logs；
2. 实现 AI Plan JSON；
3. 实现方案确认 UI；
4. 实现 executePlan；
5. 实现工具调用；
6. 实现执行日志和进度展示。

## Phase 5：测试与修复

1. 单元测试；
2. API 测试；
3. UI 测试；
4. AI 方案测试；
5. 异常回滚测试。

---

# 19. Codex 开发要求

Codex 开发时必须遵守：

1. 不要一次性重写整个项目；
2. 先完成数据库迁移；
3. 再完成 API；
4. 再完成前端组件；
5. 最后完成 AI；
6. 每个 Phase 完成后必须运行测试；
7. 不确定现有项目结构时，先读取项目目录和现有代码，再决定改动；
8. 不要删除现有功能；
9. 需要兼容已有表格数据；
10. 所有新增功能必须有基本错误处理。

---

# 20. 最小可用版本定义

如果时间有限，V2 最小可用版本必须包含：

1. 一个应用支持多个表；
2. 可以创建 relation 字段；
3. relation 字段可以下拉选择目标表记录；
4. select 字段可以设置颜色；
5. AI 先输出方案，用户确认后再执行。

可以暂缓：

1. lookup；
2. rollup；
3. formula；
4. kanban 视图；
5. 高级权限；
6. 批量导入；
7. 自动化流程。

---

# 21. V2.1 后续规划

V2.1 建议实现：

## 21.1 Lookup 字段

从关联表中自动带出字段。

示例：

```text
商品表.商品分类 → 分类表.分类编码
```

## 21.2 Rollup 字段

基于关联记录做聚合统计。

示例：

```text
客户表.订单总金额 = sum(订单表.金额)
```

## 21.3 Formula 字段

示例：

```text
销售金额 = 单价 * 数量
```

## 21.4 AI 生成完整业务系统

示例：

```text
帮我创建一个进销存系统
```

AI 自动生成：

- 商品表；
- 分类表；
- 供应商表；
- 客户表；
- 入库表；
- 出库表；
- 库存流水表；
- 库存统计视图；
- 表关联关系。

---

# 22. 最终交付物

开发完成后应包含：

1. 数据库迁移文件；
2. 后端 API；
3. 前端多表 UI；
4. 字段设置面板；
5. Relation 字段编辑器；
6. 彩色 Select Tag；
7. AI 助理确认式执行流程；
8. 基础测试；
9. README 更新；
10. 示例应用模板：商品管理系统。
