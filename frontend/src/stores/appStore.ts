/**
 * 应用全局状态管理
 * 使用 Zustand 管理全局状态
 */

import { create } from 'zustand'
import type { SystemStatus, Platform, AppOptions } from '../services/api'

// 默认配置选项（当 API 加载失败时使用）
const DEFAULT_APP_OPTIONS: AppOptions = {
  verification_statuses: [
    { value: 'none', label: '未认证' },
    { value: 'personal', label: '个人认证' },
    { value: 'enterprise', label: '企业/机构认证' },
  ],
  post_types: ['图文', '视频', '直播', '笔记', '短视频', '文章', '专栏'],
  category_options: [
    { value: '职场成长', label: '💼 职场成长', sub_suggestions: ['职场技能', '职场心理', '求职面试', '个人成长', '副业兼职'] },
    { value: '生活方式', label: '🏠 生活方式', sub_suggestions: ['家居好物', '日常分享', '极简生活', '租房装修'] },
    { value: '美食探店', label: '🍜 美食探店', sub_suggestions: ['家常菜谱', '探店测评', '烘焙甜点', '减脂餐'] },
    { value: '美妆护肤', label: '💄 美妆护肤', sub_suggestions: ['护肤教程', '彩妆技巧', '产品测评', '成分分析'] },
    { value: '穿搭时尚', label: '👗 穿搭时尚', sub_suggestions: ['日常穿搭', '通勤穿搭', '平价好物', '风格研究'] },
    { value: '旅行攻略', label: '✈️ 旅行攻略', sub_suggestions: ['国内游', '出境游', '省钱攻略', '小众景点'] },
    { value: '科技数码', label: '📱 科技数码', sub_suggestions: ['手机评测', '电脑硬件', '智能家居', 'AI工具'] },
    { value: '情感心理', label: '❤️ 情感心理', sub_suggestions: ['恋爱关系', '自我成长', '心理健康', '人际关系'] },
    { value: '母婴育儿', label: '👶 母婴育儿', sub_suggestions: ['孕期知识', '育儿经验', '早教启蒙', '母婴好物'] },
    { value: '健身运动', label: '🏃 健身运动', sub_suggestions: ['减脂塑形', '居家健身', '跑步', '瑜伽'] },
    { value: '知识科普', label: '📚 知识科普', sub_suggestions: ['历史人文', '科学常识', '法律知识', '经济金融'] },
    { value: '搞笑娱乐', label: '🎭 搞笑娱乐', sub_suggestions: ['段子', '影视解说', '综艺', '明星八卦'] },
  ],
  content_styles: ['干货教程型', '故事叙述型', '种草推荐型', '测评对比型', '观点输出型', '情绪共鸣型', '记录分享型'],
  model_types: {
    openai: {
      label: 'OpenAI',
      color: 'bg-green-500',
      text_color: 'text-green-600 dark:text-green-400',
      bg_color: 'bg-green-100 dark:bg-green-900/30',
      description: '支持 OpenAI 官方及所有 OpenAI 兼容模型',
      default_url: 'https://api.openai.com/v1',
    },
    claude: {
      label: 'Claude',
      color: 'bg-yellow-500',
      text_color: 'text-yellow-600 dark:text-yellow-400',
      bg_color: 'bg-yellow-100 dark:bg-yellow-900/30',
      description: '支持 Anthropic 官方模型及 Claude 兼容模型',
      default_url: 'https://api.anthropic.com',
    },
    'azure-openai': {
      label: 'Azure-OpenAI',
      color: 'bg-blue-500',
      text_color: 'text-blue-600 dark:text-blue-400',
      bg_color: 'bg-blue-100 dark:bg-blue-900/30',
      description: '微软 Azure 平台上的 OpenAI 模型',
      default_url: 'https://{resource}.openai.azure.com',
    },
  },
  url_examples: [
    { label: 'OpenAI 官方', url: 'https://api.openai.com/v1' },
    { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
    { label: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { label: '硅基流动', url: 'https://api.siliconflow.cn/v1' },
    { label: 'Claude', url: 'https://api.anthropic.com' },
  ],
}

interface AppState {
  // 应用选项配置（从后端动态加载）
  appOptions: AppOptions
  appOptionsLoaded: boolean
  setAppOptions: (options: AppOptions) => void
  
  // 系统状态
  systemStatus: SystemStatus | null
  setSystemStatus: (status: SystemStatus) => void
  
  // 平台列表
  platforms: Platform[]
  setPlatforms: (platforms: Platform[]) => void
  
  // 当前选中的平台
  selectedPlatform: string
  setSelectedPlatform: (platform: string) => void
  
  // 全局加载状态
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  
  // Toast 消息
  toast: { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  hideToast: () => void
  
  // 全局选题生成状态（跨会话持久，确保同一时刻只有一个选题在生成）
  extractingSessionId: string | null
  extractingSessionTitle: string
  startExtraction: (sessionId: string, sessionTitle: string) => void
  finishExtraction: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // 应用选项配置
  appOptions: DEFAULT_APP_OPTIONS,
  appOptionsLoaded: false,
  setAppOptions: (options) => set({ appOptions: options, appOptionsLoaded: true }),
  
  // 系统状态
  systemStatus: null,
  setSystemStatus: (status) => set({ systemStatus: status }),
  
  // 平台列表
  platforms: [],
  setPlatforms: (platforms) => set({ platforms }),
  
  // 当前选中的平台
  selectedPlatform: 'xiaohongshu',
  setSelectedPlatform: (platform) => set({ selectedPlatform: platform }),
  
  // 全局加载状态
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  
  // Toast 消息
  toast: null,
  showToast: (type, message) => {
    set({ toast: { type, message } })
    // 自动隐藏
    setTimeout(() => set({ toast: null }), 3000)
  },
  hideToast: () => set({ toast: null }),
  
  // 全局选题生成状态
  extractingSessionId: null,
  extractingSessionTitle: '',
  startExtraction: (sessionId, sessionTitle) => set({
    extractingSessionId: sessionId,
    extractingSessionTitle: sessionTitle,
  }),
  finishExtraction: () => set({
    extractingSessionId: null,
    extractingSessionTitle: '',
  }),
}))
