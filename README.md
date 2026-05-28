# Open Typeless

> **This project is a showcase for the [Trellis](https://github.com/mindfold-ai/Trellis) framework.**
>
> **本项目是 [Trellis](https://github.com/mindfold-ai/Trellis) 框架的示例项目。**

---

macOS 语音输入工具，支持实时转写和整合转写两种语音输入模式。

## 功能特性

- 🎤 **实时转写** - 长按右 Option 键说话，松开自动输入
- ✍️ **整合转写** - 短按右 Option 键开始，再短按一次结束，自动用豆包大模型整理后输入
- ⚡ **实时转录** - 基于火山引擎大模型，流式显示识别结果
- 🧠 **智能整理** - 去除口癖、修正错误、结构化输出
- 🪟 **悬浮窗显示** - 毛玻璃效果，显示录音状态和转录文字
- 🎯 **光标插入** - 自动将文字插入到当前光标位置，无需切换窗口
- 🔒 **不抢焦点** - 悬浮窗不会打断你的工作流

## 系统要求

- macOS 12.0+
- Node.js 18+
- pnpm

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填入火山引擎配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 火山引擎豆包语音识别配置
VOLCENGINE_APP_ID=你的APP_ID
VOLCENGINE_ACCESS_TOKEN=你的Access_Token
VOLCENGINE_RESOURCE_ID=volc.bigasr.sauc.duration

# 豆包整理模型配置（用于整合转写）
DOUBAO_API_KEY=你的火山方舟API_KEY
DOUBAO_MODEL=你的豆包模型ID或推理接入点ID
```

### 3. 获取火山引擎配置

1. 访问 [火山引擎控制台](https://console.volcengine.com/)
2. 开通「语音技术」-「流式语音识别大模型」服务
3. 创建应用，获取 `APP_ID`
4. 在「流式语音识别大模型」页面，点击眼睛图标获取 `Access Token`
5. Resource ID 一般使用：
   - `volc.bigasr.sauc.duration` - 大模型流式识别小时版
6. 如需使用整合转写模式，还需要：
   - 在火山方舟获取 `API Key`
   - 准备豆包模型 ID 或推理接入点 ID

### 4. 启动应用

```bash
pnpm start
```

### 5. 授权系统权限

首次启动时，需要授权以下权限：

- **麦克风权限** - 用于录音
- **辅助功能权限** - 用于全局快捷键和文字插入

在「系统设置」-「隐私与安全性」中授权。

## 使用方法

1. 启动应用后，会在后台运行
2. 实时转写模式：
   - **长按右 Option 键**开始录音
   - 悬浮窗会显示实时转录文字
   - **松开按键**后自动插入识别结果
3. 整合转写模式：
   - **短按右 Option 键**开始录音
   - 再**短按一次右 Option 键**结束录音
   - 应用会调用豆包大模型对内容进行整理、去口癖、纠错、结构化后再插入
4. 悬浮窗会在完成后自动隐藏

## 项目结构

```
src/
├── main.ts                 # Electron 主进程入口
├── preload.ts             # 预加载脚本 (IPC 桥接)
├── renderer.ts            # 渲染进程入口
├── main/
│   ├── ipc/               # IPC 处理器
│   ├── services/          # 主进程服务
│   │   ├── asr/           # 火山引擎 ASR 客户端
│   │   ├── keyboard/      # 全局键盘监听
│   │   └── push-to-talk/  # Push-to-Talk 协调服务
│   └── windows/           # 窗口管理
├── renderer/
│   └── src/modules/asr/   # ASR 相关 React 组件
└── shared/                # 共享类型和常量
```

## 开发

```bash
# 启动开发模式
pnpm start

# 类型检查
pnpm typecheck

# 代码检查
pnpm lint

# 打包
pnpm package

# 构建安装包
pnpm make
```

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **React** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **火山引擎 ASR** - 语音识别服务
- **uiohook-napi** - 全局键盘监听
- **node-insert-text** - 文字插入

## 常见问题

### Q: 快捷键没有反应？

确保已授权「辅助功能」权限。在「系统设置」-「隐私与安全性」-「辅助功能」中添加应用。

### Q: 文字无法插入？

1. 确保目标应用支持文字输入
2. 确保光标在文本输入区域
3. 检查「辅助功能」权限是否正确授权

### Q: 语音识别延迟较高？

首次连接火山引擎服务需要建立 WebSocket 连接，可能有 1-2 秒延迟。后续使用会更快。

### Q: 如何更换快捷键？

目前快捷键固定为右 Option 键。如需自定义，可修改 `src/main/services/keyboard/keyboard.service.ts` 中的 `triggerKey` 配置。

## License

MIT
