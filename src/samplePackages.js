export function createBudgetPackage() {
  return {
    manifest: {
      packageVersion: '1.0',
      id: 'budget-book',
      name: '家庭记账本',
      description: '记录收入、支出、分类和月度统计。',
      icon: 'wallet',
      version: '1.0.0',
      author: 'local-user',
      createdBy: 'ai',
      tags: ['finance', 'personal']
    },
    schema: {
      entities: [
        {
          id: 'transaction',
          name: '账目',
          fields: [
            { id: 'type', label: '类型', type: 'select', required: true, options: ['收入', '支出'] },
            { id: 'amount', label: '金额', type: 'number', required: true },
            { id: 'category', label: '分类', type: 'select', options: ['餐饮', '交通', '购物', '工资', '其他'] },
            { id: 'date', label: '日期', type: 'date', required: true },
            { id: 'note', label: '备注', type: 'textarea' }
          ]
        }
      ]
    },
    ui: {
      home: {
        layout: 'dashboard',
        cards: [
          { type: 'stat', title: '总支出', entity: 'transaction', operation: 'sum', field: 'amount', filter: { type: '支出' } },
          { type: 'quickAction', title: '新增账目', action: 'openCreateForm', entity: 'transaction' }
        ]
      },
      pages: [
        { id: 'transaction-list', title: '账目列表', type: 'list', entity: 'transaction', features: ['create', 'edit', 'delete', 'search', 'export'] },
        { id: 'category-chart', title: '分类统计', type: 'chart', entity: 'transaction', chart: { type: 'pie', groupBy: 'category', value: 'amount' } }
      ]
    },
    actions: {
      actions: [
        {
          id: 'monthly_summary',
          name: '生成月度总结',
          type: 'ai.generateText',
          input: { records: 'transaction' },
          prompt: '根据这些账目数据，生成一段简洁的月度收支总结，指出主要支出类别和节省建议。'
        }
      ]
    },
    prompts: {
      systemPrompt: '你是家庭记账本助手，帮助用户记录、统计和优化个人收支。',
      suggestedCommands: ['增加旅游预算功能', '生成本月总结', '添加一个按分类统计页面']
    }
  };
}

export function createTodoPackage() {
  return {
    manifest: {
      packageVersion: '1.0',
      id: 'todo-list',
      name: '待办事项工具',
      description: '记录任务、截止日期、优先级和完成状态。',
      icon: 'check-square',
      version: '1.0.0',
      author: 'local-user',
      createdBy: 'ai',
      tags: ['productivity']
    },
    schema: {
      entities: [
        {
          id: 'task',
          name: '任务',
          fields: [
            { id: 'title', label: '任务', type: 'text', required: true },
            { id: 'due_date', label: '截止日期', type: 'date' },
            { id: 'priority', label: '优先级', type: 'select', options: ['低', '中', '高'] },
            { id: 'done', label: '完成状态', type: 'boolean' },
            { id: 'note', label: '备注', type: 'textarea' }
          ]
        }
      ]
    },
    ui: {
      home: { layout: 'dashboard', cards: [{ type: 'stat', title: '待办总数', entity: 'task', operation: 'count' }] },
      pages: [
        { id: 'task-list', title: '任务列表', type: 'list', entity: 'task', features: ['create', 'edit', 'delete', 'search', 'export'] },
        { id: 'priority-chart', title: '优先级统计', type: 'chart', entity: 'task', chart: { type: 'bar', groupBy: 'priority', value: 'count' } }
      ]
    },
    actions: { actions: [{ id: 'today_tasks', name: '查询今日任务', type: 'data.queryRecords', input: { records: 'task' } }] },
    prompts: {
      systemPrompt: '你是待办事项助手，帮助用户安排任务。',
      suggestedCommands: ['增加今日任务页面', '增加任务标签字段']
    }
  };
}

export function createArticlePackage() {
  return {
    manifest: {
      packageVersion: '1.0',
      id: 'wechat-article-generator',
      name: '公众号文章生成器',
      description: '输入主题、读者和风格，生成标题、大纲和正文。',
      icon: 'edit',
      version: '1.0.0',
      author: 'local-user',
      createdBy: 'ai',
      tags: ['writing', 'ai']
    },
    schema: {
      entities: [
        {
          id: 'article',
          name: '文章',
          fields: [
            { id: 'topic', label: '主题', type: 'text', required: true },
            { id: 'audience', label: '目标读者', type: 'text' },
            { id: 'style', label: '文章风格', type: 'select', options: ['专业', '轻松', '故事化', '干货'] },
            { id: 'title', label: '标题', type: 'text' },
            { id: 'outline', label: '大纲', type: 'textarea' },
            { id: 'body', label: '正文', type: 'richText' }
          ]
        }
      ]
    },
    ui: {
      home: { layout: 'dashboard', cards: [{ type: 'quickAction', title: '新建文章', action: 'openCreateForm', entity: 'article' }] },
      pages: [
        { id: 'article-list', title: '文章列表', type: 'list', entity: 'article', features: ['create', 'edit', 'delete', 'search', 'export'] },
        { id: 'article-editor', title: '文章编辑器', type: 'editor', entity: 'article' }
      ]
    },
    actions: {
      actions: [
        {
          id: 'generate_article',
          name: '生成文章',
          type: 'ai.generateText',
          input: { records: 'article' },
          prompt: '根据主题、目标读者和风格生成公众号文章标题、大纲和正文。'
        },
        { id: 'export_markdown', name: '导出 Markdown', type: 'export.markdown', input: { records: 'article' } }
      ]
    },
    prompts: {
      systemPrompt: '你是公众号文章创作助手。',
      suggestedCommands: ['增加爆款标题分析', '增加小红书风格改写']
    }
  };
}

export function createCrmPackage() {
  return {
    manifest: {
      packageVersion: '1.0',
      id: 'customer-manager',
      name: '客户管理器',
      description: '记录客户姓名、电话、来源、跟进状态和备注。',
      icon: 'users',
      version: '1.0.0',
      author: 'local-user',
      createdBy: 'ai',
      tags: ['crm']
    },
    schema: {
      entities: [
        {
          id: 'customer',
          name: '客户',
          fields: [
            { id: 'name', label: '姓名', type: 'text', required: true },
            { id: 'phone', label: '电话', type: 'text' },
            { id: 'source', label: '来源', type: 'select', options: ['朋友介绍', '线上咨询', '线下活动', '其他'] },
            { id: 'status', label: '跟进状态', type: 'select', options: ['新客户', '跟进中', '已成交', '暂缓'] },
            { id: 'note', label: '备注', type: 'textarea' }
          ]
        }
      ]
    },
    ui: {
      home: { layout: 'dashboard', cards: [{ type: 'stat', title: '客户总数', entity: 'customer', operation: 'count' }] },
      pages: [
        { id: 'customer-list', title: '客户列表', type: 'list', entity: 'customer', features: ['create', 'edit', 'delete', 'search', 'export'] },
        { id: 'status-chart', title: '状态统计', type: 'chart', entity: 'customer', chart: { type: 'bar', groupBy: 'status', value: 'count' } }
      ]
    },
    actions: { actions: [{ id: 'export_customers', name: '导出客户 CSV', type: 'export.csv', input: { records: 'customer' } }] },
    prompts: {
      systemPrompt: '你是客户管理助手。',
      suggestedCommands: ['增加跟进提醒日期', '增加客户分级字段']
    }
  };
}

export function pickSamplePackage(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (text.includes('公众号') || text.includes('文章') || text.includes('写作')) return createArticlePackage();
  const scenario = bestScenarioMatch(text);
  if (scenario) return createScenarioPackage(scenario);
  if (text.includes('客户') || text.includes('crm')) return createCrmPackage();
  if (text.includes('待办') || text.includes('todo') || text.includes('任务')) return createTodoPackage();
  return createBudgetPackage();
}

function bestScenarioMatch(text) {
  let best = null;
  let bestScore = 0;
  for (const scenario of scenarioDefinitions()) {
    let score = 0;
    if (text.includes(scenario.name.toLowerCase())) score += 1000;
    for (const keyword of scenario.keywords) {
      const normalized = keyword.toLowerCase();
      if (text.includes(normalized)) score += 10 + normalized.length;
    }
    if (score > bestScore) {
      best = scenario;
      bestScore = score;
    }
  }
  return best;
}

export function allSamplePackages() {
  return [createBudgetPackage(), createTodoPackage(), createArticlePackage(), createCrmPackage(), ...scenarioDefinitions().map(createScenarioPackage)];
}

export function scenarioDefinitions() {
  return [
    {
      id: 'inventory-manager',
      name: '库存管理器',
      description: '记录物品名称、分类、数量、位置和补货状态。',
      entityId: 'item',
      entityName: '物品',
      keywords: ['库存', '仓库', '物品', 'inventory'],
      fields: [
        textField('name', '名称', true),
        selectField('category', '分类', ['办公', '耗材', '设备', '其他']),
        numberField('quantity', '数量', true),
        textField('location', '位置'),
        selectField('restock_status', '补货状态', ['充足', '需补货', '已下单'])
      ],
      chartField: 'category',
      suggestedCommands: ['增加低库存提醒', '增加供应商字段']
    },
    {
      id: 'habit-tracker',
      name: '习惯打卡器',
      description: '记录习惯名称、日期、完成状态和连续打卡。',
      entityId: 'habit_record',
      entityName: '打卡',
      keywords: ['习惯', '打卡', '自律', 'habit'],
      fields: [
        textField('habit', '习惯', true),
        dateField('date', '日期', true),
        booleanField('done', '完成'),
        numberField('streak', '连续天数'),
        textareaField('note', '备注')
      ],
      chartField: 'done',
      suggestedCommands: ['增加每周统计页面', '增加目标天数字段']
    },
    {
      id: 'reading-list',
      name: '读书清单',
      description: '记录书名、作者、阅读状态、评分和摘录。',
      entityId: 'book',
      entityName: '书籍',
      keywords: ['读书', '书单', '阅读', 'book'],
      fields: [
        textField('title', '书名', true),
        textField('author', '作者'),
        selectField('status', '阅读状态', ['想读', '在读', '已读']),
        numberField('rating', '评分'),
        textareaField('excerpt', '摘录')
      ],
      chartField: 'status',
      suggestedCommands: ['增加年度阅读统计', '增加推荐理由字段']
    },
    {
      id: 'workout-log',
      name: '健身记录',
      description: '记录训练项目、日期、时长、强度和感受。',
      entityId: 'workout',
      entityName: '训练',
      keywords: ['健身', '运动', '训练', 'workout'],
      fields: [
        textField('exercise', '训练项目', true),
        dateField('date', '日期', true),
        numberField('duration', '时长'),
        selectField('intensity', '强度', ['低', '中', '高']),
        textareaField('note', '感受')
      ],
      chartField: 'intensity',
      suggestedCommands: ['增加周训练统计', '增加消耗热量字段']
    },
    {
      id: 'travel-planner',
      name: '旅行计划器',
      description: '记录目的地、日期、预算、状态和行程备注。',
      entityId: 'trip',
      entityName: '行程',
      keywords: ['旅行', '旅游', '行程', 'travel'],
      fields: [
        textField('destination', '目的地', true),
        dateField('start_date', '开始日期'),
        dateField('end_date', '结束日期'),
        numberField('budget', '预算'),
        selectField('status', '状态', ['计划中', '已预订', '已完成'])
      ],
      chartField: 'status',
      suggestedCommands: ['增加费用明细', '增加打包清单页面']
    },
    {
      id: 'study-plan',
      name: '学习计划器',
      description: '记录课程、学习日期、进度、难度和复习备注。',
      entityId: 'study_task',
      entityName: '学习任务',
      keywords: ['学习', '课程', '复习', 'study'],
      fields: [
        textField('subject', '科目', true),
        dateField('date', '学习日期'),
        numberField('progress', '进度百分比'),
        selectField('difficulty', '难度', ['低', '中', '高']),
        textareaField('note', '复习备注')
      ],
      chartField: 'difficulty',
      suggestedCommands: ['增加考试日期字段', '增加错题统计页面']
    },
    {
      id: 'invoice-tracker',
      name: '发票管理器',
      description: '记录发票抬头、金额、日期、报销状态和备注。',
      entityId: 'invoice',
      entityName: '发票',
      keywords: ['发票', '报销', 'invoice'],
      fields: [
        textField('title', '发票抬头', true),
        numberField('amount', '金额', true),
        dateField('date', '开票日期'),
        selectField('status', '报销状态', ['未提交', '审核中', '已报销']),
        textareaField('note', '备注')
      ],
      chartField: 'status',
      sumField: 'amount',
      suggestedCommands: ['增加报销人字段', '增加月度金额统计']
    },
    {
      id: 'project-tracker',
      name: '项目跟踪器',
      description: '记录项目名称、负责人、状态、截止日期和风险。',
      entityId: 'project',
      entityName: '项目',
      keywords: ['项目', '进度', 'project'],
      fields: [
        textField('name', '项目名称', true),
        textField('owner', '负责人'),
        selectField('status', '状态', ['未开始', '进行中', '已完成', '延期']),
        dateField('deadline', '截止日期'),
        textareaField('risk', '风险')
      ],
      chartField: 'status',
      suggestedCommands: ['增加里程碑页面', '增加项目优先级字段']
    },
    {
      id: 'meeting-notes',
      name: '会议纪要管理器',
      description: '记录会议主题、日期、参与人、结论和行动项。',
      entityId: 'meeting',
      entityName: '会议',
      keywords: ['会议', '纪要', 'meeting'],
      fields: [
        textField('topic', '会议主题', true),
        dateField('date', '日期'),
        textField('participants', '参与人'),
        textareaField('decision', '结论'),
        textareaField('actions', '行动项')
      ],
      chartField: 'date',
      suggestedCommands: ['增加待办跟进字段', '增加会议总结 Action']
    },
    {
      id: 'job-application-tracker',
      name: '求职跟踪器',
      description: '记录公司、岗位、投递日期、面试状态和反馈。',
      entityId: 'application',
      entityName: '投递',
      keywords: ['求职', '面试', '投递', 'job'],
      fields: [
        textField('company', '公司', true),
        textField('role', '岗位'),
        dateField('applied_date', '投递日期'),
        selectField('status', '面试状态', ['已投递', '笔试', '面试', 'Offer', '拒绝']),
        textareaField('feedback', '反馈')
      ],
      chartField: 'status',
      suggestedCommands: ['增加薪资范围字段', '增加跟进提醒日期']
    },
    {
      id: 'recipe-collection',
      name: '菜谱收藏夹',
      description: '记录菜名、分类、难度、耗时和做法。',
      entityId: 'recipe',
      entityName: '菜谱',
      keywords: ['菜谱', '食谱', '做饭', 'recipe'],
      fields: [
        textField('name', '菜名', true),
        selectField('category', '分类', ['家常菜', '快手菜', '甜品', '主食']),
        selectField('difficulty', '难度', ['简单', '中等', '复杂']),
        numberField('minutes', '耗时分钟'),
        textareaField('steps', '做法')
      ],
      chartField: 'category',
      suggestedCommands: ['增加食材清单字段', '增加本周菜单页面']
    },
    {
      id: 'subscription-tracker',
      name: '订阅管理器',
      description: '记录订阅服务、费用、周期、续费日期和状态。',
      entityId: 'subscription',
      entityName: '订阅',
      keywords: ['订阅', '会员', '续费', 'subscription'],
      fields: [
        textField('service', '服务名称', true),
        numberField('cost', '费用'),
        selectField('cycle', '周期', ['月付', '季付', '年付']),
        dateField('renew_date', '续费日期'),
        booleanField('active', '启用')
      ],
      chartField: 'cycle',
      sumField: 'cost',
      suggestedCommands: ['增加续费提醒', '增加年度费用统计']
    },
    {
      id: 'asset-manager',
      name: '资产管理器',
      description: '记录资产名称、类型、价值、购买日期和位置。',
      entityId: 'asset',
      entityName: '资产',
      keywords: ['资产', '设备', '固定资产', 'asset'],
      fields: [
        textField('name', '资产名称', true),
        selectField('type', '类型', ['电子设备', '家具', '工具', '其他']),
        numberField('value', '价值'),
        dateField('purchase_date', '购买日期'),
        textField('location', '位置')
      ],
      chartField: 'type',
      sumField: 'value',
      suggestedCommands: ['增加折旧字段', '增加维护日期']
    },
    {
      id: 'bug-tracker',
      name: '缺陷跟踪器',
      description: '记录缺陷标题、严重程度、状态、负责人和复现步骤。',
      entityId: 'bug',
      entityName: '缺陷',
      keywords: ['bug', '缺陷', '问题跟踪'],
      fields: [
        textField('title', '标题', true),
        selectField('severity', '严重程度', ['低', '中', '高', '阻塞']),
        selectField('status', '状态', ['待处理', '修复中', '已修复', '关闭']),
        textField('owner', '负责人'),
        textareaField('steps', '复现步骤')
      ],
      chartField: 'status',
      suggestedCommands: ['增加版本字段', '增加严重程度统计']
    },
    {
      id: 'content-calendar',
      name: '内容日历',
      description: '记录选题、平台、发布日期、状态和素材备注。',
      entityId: 'content_item',
      entityName: '内容',
      keywords: ['内容日历', '选题', '发布计划', 'content'],
      fields: [
        textField('topic', '选题', true),
        selectField('platform', '平台', ['公众号', '小红书', '视频号', '微博']),
        dateField('publish_date', '发布日期'),
        selectField('status', '状态', ['构思', '撰写中', '已发布']),
        textareaField('materials', '素材备注')
      ],
      chartField: 'platform',
      suggestedCommands: ['增加爆款标题 Action', '增加月度发布统计']
    },
    {
      id: 'goal-tracker',
      name: '目标追踪器',
      description: '记录目标、截止日期、进度、优先级和复盘。',
      entityId: 'goal',
      entityName: '目标',
      keywords: ['目标', 'okr', '计划追踪', 'goal'],
      fields: [
        textField('title', '目标', true),
        dateField('deadline', '截止日期'),
        numberField('progress', '进度百分比'),
        selectField('priority', '优先级', ['低', '中', '高']),
        textareaField('review', '复盘')
      ],
      chartField: 'priority',
      suggestedCommands: ['增加里程碑字段', '增加本周目标页面']
    },
    {
      id: 'pet-care-log',
      name: '宠物护理记录',
      description: '记录宠物、护理项目、日期、状态和备注。',
      entityId: 'pet_care',
      entityName: '护理',
      keywords: ['宠物', '喂养', '护理', 'pet'],
      fields: [
        textField('pet_name', '宠物名称', true),
        selectField('care_type', '护理类型', ['喂食', '洗澡', '疫苗', '体检']),
        dateField('date', '日期'),
        selectField('status', '状态', ['待完成', '已完成', '需复查']),
        textareaField('note', '备注')
      ],
      chartField: 'care_type',
      suggestedCommands: ['增加下次提醒日期', '增加花费字段']
    },
    {
      id: 'plant-care-log',
      name: '植物养护记录',
      description: '记录植物名称、养护动作、日期、状态和观察。',
      entityId: 'plant_care',
      entityName: '养护',
      keywords: ['植物', '养花', '浇水', 'plant'],
      fields: [
        textField('plant_name', '植物名称', true),
        selectField('care_action', '养护动作', ['浇水', '施肥', '修剪', '换盆']),
        dateField('date', '日期'),
        selectField('status', '状态', ['正常', '需关注', '异常']),
        textareaField('observation', '观察')
      ],
      chartField: 'care_action',
      suggestedCommands: ['增加下次浇水日期', '增加光照字段']
    },
    {
      id: 'medication-reminder',
      name: '用药提醒',
      description: '记录药品、剂量、服用时间、状态和注意事项。',
      entityId: 'medication',
      entityName: '用药',
      keywords: ['用药', '吃药', '药品', 'medication'],
      fields: [
        textField('medicine', '药品', true),
        textField('dose', '剂量'),
        textField('time', '服用时间'),
        selectField('status', '状态', ['未服用', '已服用', '跳过']),
        textareaField('note', '注意事项')
      ],
      chartField: 'status',
      suggestedCommands: ['增加库存数量字段', '增加复诊日期']
    },
    {
      id: 'mood-journal',
      name: '情绪日记',
      description: '记录日期、情绪、能量、触发事件和反思。',
      entityId: 'mood_entry',
      entityName: '情绪',
      keywords: ['情绪', '心情', '日记', 'mood'],
      fields: [
        dateField('date', '日期', true),
        selectField('mood', '情绪', ['开心', '平静', '焦虑', '低落']),
        numberField('energy', '能量分数'),
        textareaField('trigger', '触发事件'),
        textareaField('reflection', '反思')
      ],
      chartField: 'mood',
      suggestedCommands: ['增加睡眠时长字段', '增加每周情绪统计']
    },
    {
      id: 'event-planner',
      name: '活动策划器',
      description: '记录活动名称、日期、地点、预算和筹备状态。',
      entityId: 'event',
      entityName: '活动',
      keywords: ['活动', '策划', '聚会', 'event'],
      fields: [
        textField('name', '活动名称', true),
        dateField('date', '日期'),
        textField('venue', '地点'),
        numberField('budget', '预算'),
        selectField('status', '筹备状态', ['筹备中', '已确认', '已完成'])
      ],
      chartField: 'status',
      sumField: 'budget',
      suggestedCommands: ['增加嘉宾名单字段', '增加任务清单页面']
    },
    {
      id: 'gift-list',
      name: '礼物清单',
      description: '记录收礼人、礼物、预算、节日和购买状态。',
      entityId: 'gift',
      entityName: '礼物',
      keywords: ['礼物', '礼品', '送礼', 'gift'],
      fields: [
        textField('recipient', '收礼人', true),
        textField('gift_name', '礼物'),
        numberField('budget', '预算'),
        textField('occasion', '节日'),
        selectField('status', '购买状态', ['想法', '已购买', '已送出'])
      ],
      chartField: 'status',
      sumField: 'budget',
      suggestedCommands: ['增加购买链接字段', '增加提醒日期']
    },
    {
      id: 'home-maintenance-log',
      name: '家庭维修记录',
      description: '记录维修项目、位置、日期、费用和处理状态。',
      entityId: 'maintenance',
      entityName: '维修',
      keywords: ['维修', '家修', '维护', 'maintenance'],
      fields: [
        textField('item', '维修项目', true),
        textField('location', '位置'),
        dateField('date', '日期'),
        numberField('cost', '费用'),
        selectField('status', '处理状态', ['待处理', '处理中', '已完成'])
      ],
      chartField: 'status',
      sumField: 'cost',
      suggestedCommands: ['增加维修师傅字段', '增加下次保养日期']
    },
    {
      id: 'rental-manager',
      name: '租房管理器',
      description: '记录房源、租客、租金、到期日期和收款状态。',
      entityId: 'rental',
      entityName: '租赁',
      keywords: ['租房', '房租', '租客', 'rental'],
      fields: [
        textField('property', '房源', true),
        textField('tenant', '租客'),
        numberField('rent', '租金'),
        dateField('due_date', '到期日期'),
        selectField('payment_status', '收款状态', ['未收', '部分', '已收'])
      ],
      chartField: 'payment_status',
      sumField: 'rent',
      suggestedCommands: ['增加押金字段', '增加合同到期提醒']
    },
    {
      id: 'training-attendance',
      name: '培训签到表',
      description: '记录学员、课程、签到日期、出勤状态和备注。',
      entityId: 'attendance',
      entityName: '签到',
      keywords: ['培训', '签到', '出勤', 'attendance'],
      fields: [
        textField('student', '学员', true),
        textField('course', '课程'),
        dateField('date', '签到日期'),
        selectField('status', '出勤状态', ['出勤', '迟到', '缺席']),
        textareaField('note', '备注')
      ],
      chartField: 'status',
      suggestedCommands: ['增加讲师字段', '增加出勤率统计']
    },
    {
      id: 'volunteer-schedule',
      name: '志愿者排班',
      description: '记录志愿者、日期、班次、岗位和状态。',
      entityId: 'shift',
      entityName: '班次',
      keywords: ['志愿者', '排班', '班次', 'volunteer'],
      fields: [
        textField('volunteer', '志愿者', true),
        dateField('date', '日期'),
        selectField('shift', '班次', ['上午', '下午', '晚上']),
        textField('role', '岗位'),
        selectField('status', '状态', ['已安排', '已确认', '请假'])
      ],
      chartField: 'shift',
      suggestedCommands: ['增加联系电话字段', '增加岗位统计']
    },
    {
      id: 'donation-tracker',
      name: '捐赠记录',
      description: '记录捐赠人、金额、项目、日期和收据状态。',
      entityId: 'donation',
      entityName: '捐赠',
      keywords: ['捐赠', '募捐', 'donation'],
      fields: [
        textField('donor', '捐赠人', true),
        numberField('amount', '金额'),
        textField('project', '项目'),
        dateField('date', '日期'),
        selectField('receipt_status', '收据状态', ['未开', '已开', '已寄送'])
      ],
      chartField: 'project',
      sumField: 'amount',
      suggestedCommands: ['增加联系方式字段', '增加月度捐赠统计']
    },
    {
      id: 'loan-tracker',
      name: '借款跟踪器',
      description: '记录借款人、金额、借出日期、归还日期和状态。',
      entityId: 'loan',
      entityName: '借款',
      keywords: ['借款', '借钱', '欠款', 'loan'],
      fields: [
        textField('borrower', '借款人', true),
        numberField('amount', '金额'),
        dateField('loan_date', '借出日期'),
        dateField('return_date', '归还日期'),
        selectField('status', '状态', ['未还', '部分归还', '已还'])
      ],
      chartField: 'status',
      sumField: 'amount',
      suggestedCommands: ['增加利息字段', '增加还款提醒']
    },
    {
      id: 'vocabulary-builder',
      name: '单词本',
      description: '记录单词、释义、例句、掌握程度和复习日期。',
      entityId: 'word',
      entityName: '单词',
      keywords: ['单词', '词汇', '背词', 'vocabulary'],
      fields: [
        textField('word', '单词', true),
        textareaField('meaning', '释义'),
        textareaField('example', '例句'),
        selectField('mastery', '掌握程度', ['陌生', '熟悉', '掌握']),
        dateField('review_date', '复习日期')
      ],
      chartField: 'mastery',
      suggestedCommands: ['增加音标字段', '增加错词统计']
    },
    {
      id: 'exam-prep-tracker',
      name: '备考计划',
      description: '记录考试科目、章节、掌握程度、复习日期和错题数。',
      entityId: 'exam_topic',
      entityName: '复习项',
      keywords: ['备考', '考试', '错题', 'exam'],
      fields: [
        textField('subject', '科目', true),
        textField('chapter', '章节'),
        selectField('mastery', '掌握程度', ['薄弱', '一般', '熟练']),
        dateField('review_date', '复习日期'),
        numberField('wrong_count', '错题数')
      ],
      chartField: 'mastery',
      suggestedCommands: ['增加考试日期字段', '增加错题分析 Action']
    },
    {
      id: 'sales-pipeline',
      name: '销售机会管理',
      description: '记录客户、机会金额、阶段、预计成交日期和备注。',
      entityId: 'opportunity',
      entityName: '机会',
      keywords: ['销售', '商机', '机会', 'sales'],
      fields: [
        textField('customer', '客户', true),
        numberField('amount', '机会金额'),
        selectField('stage', '阶段', ['线索', '沟通', '报价', '成交', '丢单']),
        dateField('close_date', '预计成交日期'),
        textareaField('note', '备注')
      ],
      chartField: 'stage',
      sumField: 'amount',
      suggestedCommands: ['增加销售负责人', '增加赢单概率字段']
    },
    {
      id: 'supplier-manager',
      name: '供应商管理器',
      description: '记录供应商、联系人、品类、评级和合作状态。',
      entityId: 'supplier',
      entityName: '供应商',
      keywords: ['供应商', '采购商', 'supplier'],
      fields: [
        textField('name', '供应商', true),
        textField('contact', '联系人'),
        selectField('category', '品类', ['原材料', '服务', '设备', '其他']),
        numberField('rating', '评级'),
        selectField('status', '合作状态', ['洽谈中', '合作中', '暂停'])
      ],
      chartField: 'category',
      suggestedCommands: ['增加合同到期日期', '增加付款周期字段']
    },
    {
      id: 'purchase-order-tracker',
      name: '采购订单跟踪',
      description: '记录订单号、供应商、金额、下单日期和到货状态。',
      entityId: 'purchase_order',
      entityName: '采购订单',
      keywords: ['采购订单', '采购', '订单跟踪', 'purchase'],
      fields: [
        textField('order_no', '订单号', true),
        textField('supplier', '供应商'),
        numberField('amount', '金额'),
        dateField('order_date', '下单日期'),
        selectField('status', '到货状态', ['待发货', '运输中', '已到货', '异常'])
      ],
      chartField: 'status',
      sumField: 'amount',
      suggestedCommands: ['增加验收日期', '增加发票状态字段']
    },
    {
      id: 'service-ticket-board',
      name: '服务工单板',
      description: '记录工单标题、客户、优先级、状态和处理说明。',
      entityId: 'ticket',
      entityName: '工单',
      keywords: ['工单', '客服', '售后', 'ticket'],
      fields: [
        textField('title', '标题', true),
        textField('customer', '客户'),
        selectField('priority', '优先级', ['低', '中', '高']),
        selectField('status', '状态', ['待处理', '处理中', '已解决']),
        textareaField('resolution', '处理说明')
      ],
      chartField: 'status',
      suggestedCommands: ['增加 SLA 截止时间', '增加客服负责人字段']
    },
    {
      id: 'warranty-tracker',
      name: '保修管理器',
      description: '记录产品、购买日期、保修到期日、供应商和状态。',
      entityId: 'warranty',
      entityName: '保修',
      keywords: ['保修', '质保', 'warranty'],
      fields: [
        textField('product', '产品', true),
        dateField('purchase_date', '购买日期'),
        dateField('expiry_date', '保修到期日'),
        textField('vendor', '供应商'),
        selectField('status', '状态', ['有效', '即将到期', '已过期'])
      ],
      chartField: 'status',
      suggestedCommands: ['增加发票编号字段', '增加到期提醒']
    },
    {
      id: 'movie-watchlist',
      name: '观影清单',
      description: '记录电影、类型、观看状态、评分和观后感。',
      entityId: 'movie',
      entityName: '电影',
      keywords: ['电影', '观影', '影视', 'movie'],
      fields: [
        textField('title', '电影', true),
        selectField('genre', '类型', ['剧情', '喜剧', '科幻', '纪录片']),
        selectField('status', '观看状态', ['想看', '已看', '搁置']),
        numberField('rating', '评分'),
        textareaField('review', '观后感')
      ],
      chartField: 'status',
      suggestedCommands: ['增加导演字段', '增加年度观影统计']
    },
    {
      id: 'music-practice-log',
      name: '音乐练习记录',
      description: '记录曲目、乐器、练习日期、时长和熟练度。',
      entityId: 'practice',
      entityName: '练习',
      keywords: ['音乐', '练琴', '乐器', 'music'],
      fields: [
        textField('piece', '曲目', true),
        textField('instrument', '乐器'),
        dateField('date', '练习日期'),
        numberField('minutes', '时长分钟'),
        selectField('mastery', '熟练度', ['生疏', '熟悉', '流畅'])
      ],
      chartField: 'mastery',
      suggestedCommands: ['增加老师点评字段', '增加周练习时长统计']
    },
    {
      id: 'baby-growth-log',
      name: '宝宝成长记录',
      description: '记录日期、身高、体重、里程碑和备注。',
      entityId: 'growth_record',
      entityName: '成长记录',
      keywords: ['宝宝', '育儿', '成长', 'baby'],
      fields: [
        dateField('date', '日期', true),
        numberField('height', '身高'),
        numberField('weight', '体重'),
        textField('milestone', '里程碑'),
        textareaField('note', '备注')
      ],
      chartField: 'date',
      suggestedCommands: ['增加疫苗日期字段', '增加照片字段']
    },
    {
      id: 'elder-care-log',
      name: '长辈照护记录',
      description: '记录照护对象、日期、事项、健康状态和备注。',
      entityId: 'care_record',
      entityName: '照护',
      keywords: ['长辈', '老人', '照护', 'elder'],
      fields: [
        textField('person', '照护对象', true),
        dateField('date', '日期'),
        textField('task', '事项'),
        selectField('health_status', '健康状态', ['良好', '需关注', '异常']),
        textareaField('note', '备注')
      ],
      chartField: 'health_status',
      suggestedCommands: ['增加用药提醒', '增加复诊日期']
    },
    {
      id: 'meal-planner',
      name: '每周菜单',
      description: '记录日期、餐次、菜品、热量和准备状态。',
      entityId: 'meal',
      entityName: '餐食',
      keywords: ['菜单', '餐食', 'meal'],
      fields: [
        dateField('date', '日期', true),
        selectField('meal_type', '餐次', ['早餐', '午餐', '晚餐', '加餐']),
        textField('dish', '菜品'),
        numberField('calories', '热量'),
        selectField('status', '准备状态', ['计划中', '已采购', '已完成'])
      ],
      chartField: 'meal_type',
      suggestedCommands: ['增加食材清单', '增加购物清单页面']
    },
    {
      id: 'grocery-list',
      name: '购物清单',
      description: '记录商品、分类、数量、预算和购买状态。',
      entityId: 'grocery',
      entityName: '商品',
      keywords: ['购物清单', '买菜', '采购清单', 'grocery'],
      fields: [
        textField('item', '商品', true),
        selectField('category', '分类', ['蔬果', '肉蛋奶', '日用品', '其他']),
        numberField('quantity', '数量'),
        numberField('budget', '预算'),
        booleanField('bought', '已购买')
      ],
      chartField: 'category',
      sumField: 'budget',
      suggestedCommands: ['增加商店字段', '增加总预算统计']
    },
    {
      id: 'cleaning-schedule',
      name: '清洁排程',
      description: '记录区域、清洁任务、频率、负责人和完成状态。',
      entityId: 'cleaning_task',
      entityName: '清洁任务',
      keywords: ['清洁', '家务', '打扫', 'cleaning'],
      fields: [
        textField('area', '区域', true),
        textField('task', '清洁任务'),
        selectField('frequency', '频率', ['每天', '每周', '每月']),
        textField('owner', '负责人'),
        booleanField('done', '完成')
      ],
      chartField: 'frequency',
      suggestedCommands: ['增加提醒日期', '增加家务评分']
    },
    {
      id: 'vehicle-maintenance',
      name: '车辆保养记录',
      description: '记录车辆、保养项目、日期、里程和费用。',
      entityId: 'vehicle_service',
      entityName: '保养',
      keywords: ['车辆', '汽车', '保养', 'vehicle'],
      fields: [
        textField('vehicle', '车辆', true),
        textField('service_item', '保养项目'),
        dateField('date', '日期'),
        numberField('mileage', '里程'),
        numberField('cost', '费用')
      ],
      chartField: 'service_item',
      sumField: 'cost',
      suggestedCommands: ['增加下次保养日期', '增加维修店字段']
    },
    {
      id: 'fuel-log',
      name: '加油记录',
      description: '记录车辆、日期、油量、金额和里程。',
      entityId: 'fuel_record',
      entityName: '加油',
      keywords: ['加油', '油耗', 'fuel'],
      fields: [
        textField('vehicle', '车辆', true),
        dateField('date', '日期'),
        numberField('liters', '油量升'),
        numberField('amount', '金额'),
        numberField('mileage', '里程')
      ],
      chartField: 'vehicle',
      sumField: 'amount',
      suggestedCommands: ['增加油价字段', '增加油耗统计']
    },
    {
      id: 'insurance-policy-manager',
      name: '保险保单管理',
      description: '记录保单名称、类型、保费、到期日和状态。',
      entityId: 'policy',
      entityName: '保单',
      keywords: ['保险', '保单', 'insurance'],
      fields: [
        textField('name', '保单名称', true),
        selectField('type', '类型', ['医疗', '车险', '寿险', '财产']),
        numberField('premium', '保费'),
        dateField('expiry_date', '到期日'),
        selectField('status', '状态', ['有效', '待续保', '已失效'])
      ],
      chartField: 'type',
      sumField: 'premium',
      suggestedCommands: ['增加受益人字段', '增加续保提醒']
    },
    {
      id: 'tax-document-tracker',
      name: '税务资料清单',
      description: '记录资料名称、年份、分类、状态和备注。',
      entityId: 'tax_document',
      entityName: '资料',
      keywords: ['税务', '报税', '税单', 'tax'],
      fields: [
        textField('name', '资料名称', true),
        numberField('year', '年份'),
        selectField('category', '分类', ['收入', '费用', '发票', '证明']),
        selectField('status', '状态', ['待收集', '已收集', '已提交']),
        textareaField('note', '备注')
      ],
      chartField: 'status',
      suggestedCommands: ['增加截止日期', '增加负责人字段']
    },
    {
      id: 'legal-case-tracker',
      name: '案件跟踪器',
      description: '记录案件名称、当事人、阶段、截止日期和备注。',
      entityId: 'case_record',
      entityName: '案件',
      keywords: ['案件', '法律', '诉讼', 'legal'],
      fields: [
        textField('case_name', '案件名称', true),
        textField('party', '当事人'),
        selectField('stage', '阶段', ['咨询', '立案', '审理', '结案']),
        dateField('deadline', '截止日期'),
        textareaField('note', '备注')
      ],
      chartField: 'stage',
      suggestedCommands: ['增加律师字段', '增加费用统计']
    },
    {
      id: 'community-member-manager',
      name: '社群成员管理',
      description: '记录成员、来源、加入日期、活跃度和标签。',
      entityId: 'member',
      entityName: '成员',
      keywords: ['社群', '成员', 'community'],
      fields: [
        textField('name', '成员', true),
        selectField('source', '来源', ['朋友推荐', '活动', '线上', '其他']),
        dateField('join_date', '加入日期'),
        selectField('activity', '活跃度', ['低', '中', '高']),
        textField('tag', '标签')
      ],
      chartField: 'activity',
      suggestedCommands: ['增加最近互动日期', '增加成员等级字段']
    },
    {
      id: 'course-feedback',
      name: '课程反馈收集',
      description: '记录学员、课程、评分、反馈内容和处理状态。',
      entityId: 'feedback',
      entityName: '反馈',
      keywords: ['课程反馈', '反馈收集', 'feedback'],
      fields: [
        textField('student', '学员', true),
        textField('course', '课程'),
        numberField('rating', '评分'),
        textareaField('content', '反馈内容'),
        selectField('status', '处理状态', ['未处理', '处理中', '已处理'])
      ],
      chartField: 'status',
      suggestedCommands: ['增加改进建议 Action', '增加平均评分统计']
    },
    {
      id: 'research-notes',
      name: '研究笔记',
      description: '记录主题、来源、关键观点、可信度和标签。',
      entityId: 'research_note',
      entityName: '笔记',
      keywords: ['研究', '资料', '笔记', 'research'],
      fields: [
        textField('topic', '主题', true),
        textField('source', '来源'),
        textareaField('insight', '关键观点'),
        selectField('credibility', '可信度', ['低', '中', '高']),
        textField('tag', '标签')
      ],
      chartField: 'credibility',
      suggestedCommands: ['增加摘要 Action', '增加引用链接字段']
    },
    {
      id: 'experiment-log',
      name: '实验记录',
      description: '记录实验名称、日期、变量、结果和结论。',
      entityId: 'experiment',
      entityName: '实验',
      keywords: ['实验', '实验记录', 'experiment'],
      fields: [
        textField('name', '实验名称', true),
        dateField('date', '日期'),
        textareaField('variables', '变量'),
        textareaField('result', '结果'),
        selectField('conclusion', '结论', ['成功', '部分成功', '失败'])
      ],
      chartField: 'conclusion',
      suggestedCommands: ['增加负责人字段', '增加复现实验日期']
    },
    {
      id: 'fundraising-pipeline',
      name: '融资跟进表',
      description: '记录投资方、轮次、金额、阶段和下一步。',
      entityId: 'investor_update',
      entityName: '融资跟进',
      keywords: ['融资', '投资人', 'fundraising'],
      fields: [
        textField('investor', '投资方', true),
        selectField('round', '轮次', ['种子轮', '天使轮', 'A轮', 'B轮']),
        numberField('amount', '金额'),
        selectField('stage', '阶段', ['初聊', '尽调', '条款', '完成']),
        textareaField('next_step', '下一步')
      ],
      chartField: 'stage',
      sumField: 'amount',
      suggestedCommands: ['增加跟进日期', '增加联系人字段']
    },
    {
      id: 'marketing-campaign-tracker',
      name: '营销活动跟踪',
      description: '记录活动名称、渠道、预算、开始日期和效果状态。',
      entityId: 'campaign',
      entityName: '活动',
      keywords: ['营销', '投放', 'campaign'],
      fields: [
        textField('name', '活动名称', true),
        selectField('channel', '渠道', ['搜索', '社媒', '邮件', '线下']),
        numberField('budget', '预算'),
        dateField('start_date', '开始日期'),
        selectField('status', '效果状态', ['计划中', '进行中', '已复盘'])
      ],
      chartField: 'channel',
      sumField: 'budget',
      suggestedCommands: ['增加转化率字段', '增加 ROI 统计']
    },
    {
      id: 'kpi-dashboard',
      name: 'KPI 跟踪器',
      description: '记录指标、目标值、实际值、周期和状态。',
      entityId: 'kpi',
      entityName: '指标',
      keywords: ['kpi', '指标', '绩效'],
      fields: [
        textField('metric', '指标', true),
        numberField('target', '目标值'),
        numberField('actual', '实际值'),
        selectField('period', '周期', ['周', '月', '季度', '年']),
        selectField('status', '状态', ['落后', '正常', '超额'])
      ],
      chartField: 'status',
      suggestedCommands: ['增加负责人字段', '增加完成率统计']
    },
    {
      id: 'risk-register',
      name: '风险登记册',
      description: '记录风险、影响等级、概率、负责人和缓解措施。',
      entityId: 'risk',
      entityName: '风险',
      keywords: ['风险', '风控', 'risk'],
      fields: [
        textField('title', '风险', true),
        selectField('impact', '影响等级', ['低', '中', '高']),
        selectField('probability', '概率', ['低', '中', '高']),
        textField('owner', '负责人'),
        textareaField('mitigation', '缓解措施')
      ],
      chartField: 'impact',
      suggestedCommands: ['增加截止日期', '增加风险矩阵页面']
    },
    {
      id: 'decision-log',
      name: '决策记录',
      description: '记录决策主题、日期、选项、结果和理由。',
      entityId: 'decision',
      entityName: '决策',
      keywords: ['决策', '决定', 'decision'],
      fields: [
        textField('topic', '决策主题', true),
        dateField('date', '日期'),
        textareaField('options', '选项'),
        textField('result', '结果'),
        textareaField('reason', '理由')
      ],
      chartField: 'date',
      suggestedCommands: ['增加参与人字段', '增加复盘日期']
    },
    {
      id: 'idea-backlog',
      name: '创意池',
      description: '记录创意、来源、分类、优先级和验证状态。',
      entityId: 'idea',
      entityName: '创意',
      keywords: ['创意', '点子', 'idea'],
      fields: [
        textField('title', '创意', true),
        textField('source', '来源'),
        selectField('category', '分类', ['产品', '内容', '运营', '其他']),
        selectField('priority', '优先级', ['低', '中', '高']),
        selectField('status', '验证状态', ['待验证', '验证中', '已采纳'])
      ],
      chartField: 'status',
      suggestedCommands: ['增加评分字段', '增加 AI 评估 Action']
    },
    {
      id: 'bookmark-manager',
      name: '链接收藏管理',
      description: '记录链接标题、URL、分类、重要性和备注。',
      entityId: 'bookmark',
      entityName: '链接',
      keywords: ['链接', '收藏', '书签', 'bookmark'],
      fields: [
        textField('title', '标题', true),
        textField('url', 'URL'),
        selectField('category', '分类', ['学习', '工具', '灵感', '其他']),
        selectField('importance', '重要性', ['低', '中', '高']),
        textareaField('note', '备注')
      ],
      chartField: 'category',
      suggestedCommands: ['增加阅读状态字段', '增加摘要 Action']
    },
    {
      id: 'contact-book',
      name: '联系人通讯录',
      description: '记录姓名、电话、邮箱、关系和备注。',
      entityId: 'contact',
      entityName: '联系人',
      keywords: ['通讯录', '联系人', 'contact'],
      fields: [
        textField('name', '姓名', true),
        textField('phone', '电话'),
        textField('email', '邮箱'),
        selectField('relationship', '关系', ['家人', '朋友', '同事', '客户']),
        textareaField('note', '备注')
      ],
      chartField: 'relationship',
      suggestedCommands: ['增加生日字段', '增加最近联系日期']
    },
    {
      id: 'classroom-gradebook',
      name: '班级成绩册',
      description: '记录学生、科目、分数、考试日期和等级。',
      entityId: 'grade',
      entityName: '成绩',
      keywords: ['成绩', '班级', 'grade'],
      fields: [
        textField('student', '学生', true),
        textField('subject', '科目'),
        numberField('score', '分数'),
        dateField('exam_date', '考试日期'),
        selectField('level', '等级', ['A', 'B', 'C', 'D'])
      ],
      chartField: 'level',
      suggestedCommands: ['增加平均分统计', '增加老师评语字段']
    },
    {
      id: 'reservation-manager',
      name: '预约管理器',
      description: '记录客户、预约项目、时间、状态和备注。',
      entityId: 'reservation',
      entityName: '预约',
      keywords: ['预约', '预订', 'reservation'],
      fields: [
        textField('customer', '客户', true),
        textField('service', '预约项目'),
        textField('time', '时间'),
        selectField('status', '状态', ['待确认', '已确认', '已完成', '已取消']),
        textareaField('note', '备注')
      ],
      chartField: 'status',
      suggestedCommands: ['增加提醒时间', '增加服务人员字段']
    },
    {
      id: 'visitor-log',
      name: '访客登记',
      description: '记录访客、来访日期、来访目的、接待人和状态。',
      entityId: 'visitor',
      entityName: '访客',
      keywords: ['访客', '来访', 'visitor'],
      fields: [
        textField('name', '访客', true),
        dateField('visit_date', '来访日期'),
        textField('purpose', '来访目的'),
        textField('host', '接待人'),
        selectField('status', '状态', ['预约', '已到访', '已离开'])
      ],
      chartField: 'status',
      suggestedCommands: ['增加证件号字段', '增加来访时段统计']
    },
    {
      id: 'equipment-booking',
      name: '设备预约表',
      description: '记录设备、预约人、日期、时段和审批状态。',
      entityId: 'booking',
      entityName: '预约',
      keywords: ['设备预约', '器材预约', 'booking'],
      fields: [
        textField('equipment', '设备', true),
        textField('person', '预约人'),
        dateField('date', '日期'),
        selectField('slot', '时段', ['上午', '下午', '晚上']),
        selectField('status', '审批状态', ['待审批', '已通过', '已拒绝'])
      ],
      chartField: 'status',
      suggestedCommands: ['增加归还状态字段', '增加使用说明字段']
    },
    {
      id: 'lab-sample-tracker',
      name: '样本管理器',
      description: '记录样本编号、类型、采集日期、状态和存放位置。',
      entityId: 'sample',
      entityName: '样本',
      keywords: ['样本', '实验样本', 'sample'],
      fields: [
        textField('sample_no', '样本编号', true),
        selectField('type', '类型', ['血液', '组织', '水样', '其他']),
        dateField('collection_date', '采集日期'),
        selectField('status', '状态', ['待检测', '检测中', '已完成']),
        textField('location', '存放位置')
      ],
      chartField: 'type',
      suggestedCommands: ['增加检测结果字段', '增加过期日期']
    }
  ];
}

export function createScenarioPackage(scenario) {
  const firstField = scenario.fields[0]?.id || 'name';
  const chartField = scenario.chartField || firstField;
  const homeCards = [{ type: 'stat', title: `${scenario.entityName}总数`, entity: scenario.entityId, operation: 'count' }];
  if (scenario.sumField) {
    homeCards.push({ type: 'stat', title: `总${fieldLabel(scenario.fields, scenario.sumField)}`, entity: scenario.entityId, operation: 'sum', field: scenario.sumField });
  }
  return {
    manifest: {
      packageVersion: '1.0',
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      icon: 'app',
      version: '1.0.0',
      author: 'local-user',
      createdBy: 'ai',
      tags: ['generated']
    },
    schema: {
      entities: [{ id: scenario.entityId, name: scenario.entityName, fields: scenario.fields }]
    },
    ui: {
      home: { layout: 'dashboard', cards: homeCards },
      pages: [
        { id: `${scenario.entityId}-list`, title: `${scenario.entityName}列表`, type: 'list', entity: scenario.entityId, features: ['create', 'edit', 'delete', 'search', 'export'] },
        { id: `${scenario.entityId}-chart`, title: `${fieldLabel(scenario.fields, chartField)}统计`, type: 'chart', entity: scenario.entityId, chart: { type: 'bar', groupBy: chartField, value: scenario.sumField || 'count' } }
      ]
    },
    actions: {
      actions: [
        { id: `query_${scenario.entityId}`, name: `查询${scenario.entityName}`, type: 'data.queryRecords', input: { records: scenario.entityId } },
        { id: `export_${scenario.entityId}`, name: `导出${scenario.entityName} CSV`, type: 'export.csv', input: { records: scenario.entityId } }
      ]
    },
    prompts: {
      systemPrompt: `你是${scenario.name}助手，帮助用户管理${scenario.entityName}。`,
      suggestedCommands: scenario.suggestedCommands || ['增加备注字段', '增加统计页面']
    }
  };
}

function fieldLabel(fields, id) {
  return fields.find((field) => field.id === id)?.label || id;
}

function textField(id, label, required = false) {
  return { id, label, type: 'text', required };
}

function textareaField(id, label, required = false) {
  return { id, label, type: 'textarea', required };
}

function numberField(id, label, required = false) {
  return { id, label, type: 'number', required };
}

function dateField(id, label, required = false) {
  return { id, label, type: 'date', required };
}

function booleanField(id, label, required = false) {
  return { id, label, type: 'boolean', required };
}

function selectField(id, label, options, required = false) {
  return { id, label, type: 'select', options, required };
}
