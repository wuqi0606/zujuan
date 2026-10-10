// ==UserScript==
// @name         组卷网/菁优网试卷打印助手
// @version      7.0.0
// @description  所见即所得试卷排版，支持版式预设、自动记忆、公式随字号缩放、顶层题目工具条与题内自然分页（组卷网 / 菁优网）
// @author       nuym, WorkingFishQ, xiaohuya
// @match        *://zujuan.xkw.com/*
// @match        *://www.jyeoo.com/*
// @icon         https://zujuan.xkw.com/favicon.ico
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/wuqi0606/zujuan/main/zujuan-print.user.js
// @downloadURL  https://raw.githubusercontent.com/wuqi0606/zujuan/main/zujuan-print.user.js
// @license      GNU Affero General Public License v3.0
// ==/UserScript==

(function () {
    'use strict';

    const Config = {
        adSelectors: ['.aside-pop.activity-btn', '.ai-entry.fixed'],
    };

    // 版本标识：便于在控制台确认当前运行的脚本版本（站点诊断时用）
    const SCRIPT_BUILD = '7.0.0';
    try { console.log('%c[组卷打印助手] v' + SCRIPT_BUILD + ' 已加载', 'color:#1677ff;font-weight:bold'); } catch (e) { /* 忽略 */ }

    // 父子 iframe 通信校验令牌：srcdoc 注入后，iframe 发出的每条消息都携带它，
    // 父级监听据此拒绝伪造消息（即使页面被植入同源第三方脚本）。每次脚本加载随机生成。
    const PREVIEW_TOKEN = 'zj' + Math.random().toString(36).slice(2, 14);

    // 共享常量与辅助：集中抽取散落的魔数，便于审阅与统一调整。
    // 沙箱 iframe（sandbox="allow-scripts" 无 allow-same-origin）postMessage 时 origin 为规范字符串 'null'；
    // 父级来源校验必须放行该值，否则沙箱消息会被一律拒收（非笔误）。
    const SANDBOX_NULL_ORIGIN = 'null';
    // 防御性超时：极端情况下防止监听常驻 / 注入永久卡住 / 就绪承诺永不兑现。
    const SAFETY_TIMEOUT_MS = 3000;
    // 分页算法循环上限，防止异常 DOM 导致死循环。
    const MAX_PAGINATE_ITER = 10000;
    // 答案显式开关：试卷详情页（#isshowAnswer）与旧版容器（.tklabel-checkbox.show-answer input）指向同一 <input>；
    // 自检与运行时检测共用此选择器，避免两边漂移。
    const ANSWER_SWITCH_SEL = '#isshowAnswer, .tklabel-checkbox.show-answer input';
    // iframe→父窗口经 postMessage 传偏好，布尔值被序列化为字符串，统一还原。
    const parseBool = v => v === true || v === 'true';

    // 公式基准尺寸缓存（模块级，跨重建持久；仅在打开新卷时清空）。
    // 用于冻结首渲时公式的实时布局尺寸，避免原站切换/显示答案重排版导致公式缩放漂移。
    let _formulaBaseBySrc = new Map();
    let _formulaBaseByIndex = [];
    function resetFormulaBaseCache() {
        _formulaBaseBySrc = new Map();
        _formulaBaseByIndex = [];
    }

    // 已处理片段缓存（模块级·全局持久，不分试卷）：按内容签名复用已构建的题目片段，
    // 同一内容在不同试卷/会话间只处理一次。内存有界（LRU 上限 FRAGMENT_CACHE_CAP），超出淘汰最旧项。
    const FRAGMENT_CACHE_CAP = 1500;
    let _fragmentCache = new Map();

    // 打印内容块注册表：单一数据源，驱动排版面板 UI 生成、读写与渲染分支。
    // 新增内容块（如未来的「分析」「详解」）只需在此追加一项，无需改多处。
    const CONTENT_BLOCKS = [
        { key: 'q', label: '试题', locked: true },
        { key: 'kp', label: '知识点' },
        { key: 'a', label: '答案' },
    ];

    // 默认字体（多处复用，单一来源）
    const DEFAULT_FONT = '"Times New Roman", SimSun, "Songti SC", serif';

    // 纸张尺寸（mm）。A4 为默认，集中定义便于将来支持 A3/B5/Letter 等。
    const A4 = { w: 210, h: 297 };

    // 菁优网公式样式包（内置兜底）：MathJye 引擎的排版规则 + 公式字体定义，url() 已绝对化。
    // 该站点公式 CSS 位于跨域 CDN，沙箱预览里用相对路径会解析失败导致字体加载不到、公式错位，
    // 故内置一份并绝对化；运行时仍会优先抓取线上最新版本（见 prefetchSiteAssets）。
    const JYEOO_FORMULA_CSS = `/* 菁优网公式引擎 MathJye 样式与字体（内置，URL 已绝对化）*/
/*菁优海体引用*/
@font-face { font-family: 'JyeooHai-AMS'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-AMS-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-AMS-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-AMS-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-AMS-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-AMS-Regular.svg#JyeooHai-AMS') format('svg'); font-weight: normal; font-style: normal; font-display: swap; }
@font-face { font-family: 'JyeooHai-AMS2'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-AMS2-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-AMS2-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-AMS2-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-AMS2-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-AMS2-Regular.svg#JyeooHai-AMS') format('svg'); font-weight: normal; font-style: normal; font-display: swap; }
@font-face { font-family: 'JyeooHai-Arrow'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Arrow-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Arrow-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Arrow-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Arrow-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Arrow-Regular.svg#JyeooHai-Arrow') format('svg'); font-weight: normal; font-style: normal; }
@font-face { font-family: 'JyeooHai-Fraktur'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Fraktur-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Fraktur-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Fraktur-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Fraktur-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Fraktur-Regular.svg#JyeooHai-Fraktur-Regular') format('svg'); font-weight: normal; font-style: normal; font-display: swap; }
@font-face { font-family: 'JyeooHai-Main-Bold'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Main-Bold-2.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Main-Bold-2.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Main-Bold-2.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Main-Bold-2.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Main-Bold-2.svg#JyeooHai-Main-Bold-2') format('svg'); font-weight: normal; font-style: normal; font-display: swap; }
@font-face { font-family: 'JyeooHai-Main-BoldItalic'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Main-BoldItalic-2.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Main-BoldItalic-2.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Main-BoldItalic-2.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Main-BoldItalic-2.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Main-BoldItalic-2.svg#JyeooHai-Main-BoldItalic-2') format('svg'); font-weight: normal; font-style: normal;  font-display: swap;}
@font-face { font-family: 'JyeooHai-Main-Italic'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Main-Italic-2.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Main-Italic-2.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Main-Italic-2.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Main-Italic-2.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Main-Italic-2.svg#JyeooHai-Main-Italic-2') format('svg'); font-weight: normal; font-style: normal; font-display: swap; }
@font-face { font-family: 'JyeooHai-Main-Regular'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Main-Regular-2.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Main-Regular-2.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Main-Regular-2.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Main-Regular-2.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Main-Regular-2.svg#JyeooHai-Main-Regular-2') format('svg'); font-weight: normal; font-style: normal; font-display: swap; }
@font-face { font-family: 'JyeooHai-Script'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Script-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Script-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Script-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Script-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Script-Regular.svg#JyeooHai-Script') format('svg'); font-weight: normal; font-style: normal;  font-display: swap;}
@font-face { font-family: 'JyeooHai-Size1'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Size1-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Size1-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Size1-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Size1-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Size1-Regular.svg#JyeooHai-Size1') format('svg'); font-weight: normal; font-style: normal; font-display: swap; }
@font-face { font-family: 'JyeooHai-Size2'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Size2-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Size2-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Size2-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Size2-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Size2-Regular.svg#JyeooHai-Size2') format('svg'); font-weight: normal; font-style: normal;  font-display: swap;}
@font-face { font-family: 'JyeooHai-Size3'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Size3-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Size3-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Size3-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Size3-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Size3-Regular.svg#JyeooHai-Size3') format('svg'); font-weight: normal; font-style: normal;  font-display: swap;}
@font-face { font-family: 'JyeooHai-Size4'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Size4-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Size4-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Size4-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Size4-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Size4-Regular.svg#JyeooHai-Size4') format('svg'); font-weight: normal; font-style: normal;  font-display: swap;}
@font-face { font-family: 'JyeooHai-Typewriter'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Typewriter-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Typewriter-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Typewriter-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Typewriter-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Typewriter-Regular.svg#JyeooHai-Typewriter') format('svg'); font-weight: normal; font-style: normal; font-display: swap; }
@font-face { font-family: 'JyeooHai-Math-Regular'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Math-Regular.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Math-Regular.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Math-Regular.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Math-Regular.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Math-Regular.svg#JyeooHai-Math-Regular') format('svg'); font-weight: normal; font-style: normal;font-display: swap;}
@font-face { font-family: 'JyeooHai-Math-Italic'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Math-Italic.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Math-Italic.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Math-Italic.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Math-Italic.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Math-Italic.svg#JyeooHai-Math-Italic') format('svg'); font-weight: normal; font-style: normal;font-display: swap;}
@font-face { font-family: 'JyeooHai-Math-Bold'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Math-Bold.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Math-Bold.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Math-Bold.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Math-Bold.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Math-Bold.svg#JyeooHai-Math-Bold') format('svg'); font-weight: normal; font-style: normal;font-display: swap;}
@font-face { font-family: 'JyeooHai-Math-BoldItalic'; src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Math-BoldItalic.eot'); src: url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/eot/JyeooHai-Math-BoldItalic.eot#iefix') format('embedded-opentype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/woff/JyeooHai-Math-BoldItalic.woff') format('woff'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/ttf/JyeooHai-Math-BoldItalic.ttf') format('truetype'), url('https://img.jyeoo.net/mathjye/css/MathJyeFonts/svg/JyeooHai-Math-BoldItalic.svg#JyeooHai-Math-BoldItalic') format('svg'); font-weight: normal; font-style: normal;font-display: swap;}

/*（顶层类 MathJye）*/
.MathJye { font-size: 14px; border: 0 none; direction: ltr; line-height: 0; display: inline-block; float: none; font-weight: normal; letter-spacing: 1px; margin: 0; padding: 0; text-align: left; text-indent: 0; text-transform: none; white-space: nowrap; word-spacing: normal; word-wrap: normal; -webkit-text-size-adjust: none; vertical-align: baseline; user-select: none; margin-top: 0.3em; margin-bottom: 0.3em;}
.MathJye { font-family: 'JyeooHai-Main-Regular','JyeooHai-Arrow','JyeooHai-AMS','JyeooHai-AMS2','Times New Roman','宋体'; }

/*字体引用*/
.JyeooHai-AMS{ font-family:'JyeooHai-AMS'; }
.JyeooHai-AMS2{ font-family:'JyeooHai-AMS2'; }
.JyeooHai-Arrow{ font-family:'JyeooHai-Arrow';}
.JyeooHai-Fraktur{ font-family:'JyeooHai-Fraktur'; }
.JyeooHai-Main-Bold{ font-family:'JyeooHai-Main-Bold'; }
.JyeooHai-Main-BoldItalic{ font-family:'JyeooHai-Main-BoldItalic'; }
.JyeooHai-Main-Italic{ font-family:'JyeooHai-Main-Italic' ;}
.JyeooHai-Main-Regular{ font-family:'JyeooHai-Main-Regular';/* -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing: grayscale; */ }
.JyeooHai-Script{ font-family:'JyeooHai-Script'; }
.JyeooHai-Size1{ font-family:'JyeooHai-Size1'; }
.JyeooHai-Size2{ font-family:'JyeooHai-Size2' ;}
.JyeooHai-Size3{ font-family:'JyeooHai-Size3'; }
.JyeooHai-Size4{ font-family:'JyeooHai-Size4' ;}
.JyeooHai-Typewriter{ font-family:'JyeooHai-Typewriter'; }
.JyeooHai-Math-Regular{ font-family: 'JyeooHai-Math-Regular'; }
.JyeooHai-Math-Italic{ font-family: 'JyeooHai-Math-Italic'; }
.JyeooHai-Math-Bold{ font-family: 'JyeooHai-Math-Bold'; }
.JyeooHai-Math-BoldItalic{ font-family: 'JyeooHai-Math-BoldItalic'; }


/*去除左右间隙*/
div.hm0 { margin-left: 0; margin-right: 0; }

.mrow, .mfrac, .msqrt, .mroot, .msub, .msup, .msupsub, .mover, .munder, .munderorder { }
/*插入框 分组后的子表达式*/
.mrow { display: inline-block; }
.mi, .math-letter, .mnormal, .mo, .math-letter, .mstyle, .mtext,.math-letter-i,.math-letter-b,.math-letter-ib { display: inline-block; }

/*空div（刘鹏需要）*/
.boxNull{display: inline-block; height: 1em; width: 0.1em;vertical-align: middle;}

/*标识符 mi*/
.mi { }
/*数量 math-letter*/
.math-letter { font-family: 'JyeooHai-Math-Regular';}
/*运算符 mo  保留空格和换行，并且会自动换行  pre-wrap -》20249.9 猴哥 改为不换行*/
.mo {box-sizing: border-box;white-space: pre;  }
/*字符串字面量ms*/
.ms { }
/*文本 mtext*/
.mtext { }
 /* .mi,.mo,.mtext{line-height: normal;} */
.mtext{line-height: normal;}
/*默认正常*/
.mnormal { font-style: normal; }
/*包含的语法错误消息 merror*/
.merror { display: inline-block; color: red;  }

/*字母、数字用菁优网数学字体，去除了行间距*/
.math-letter { font-family: 'JyeooHai-Math-Regular'; box-sizing: border-box;}
.math-letter-i{font-family: 'JyeooHai-Math-Italic'; box-sizing: border-box;}
.math-letter-b{font-family: 'JyeooHai-Main-Bold'; box-sizing: border-box;}
.math-letter-ib{font-family: 'JyeooHai-Main-BoldItalic'; box-sizing: border-box;}

.italic { font-family: 'JyeooHai-Main-Italic';}
.bold { font-family: 'JyeooHai-Main-Bold';}
.italicBold{ font-family: 'JyeooHai-Main-BoldItalic';}

.overflowH { overflow: hidden; }

.clearfix, .frac2 { *zoom: 1; }
.clearfix:after, .frac2:after { content: ""; display: block; height: 0; clear: both; }

.tright { text-align: right; }

/*分式*/
.mfrac { display: inline-block !important;/* vertical-align: calc(-50% + 0.0714em ); */vertical-align: calc(-50% + 0.255em ); text-align: center; position: relative; }
.mfrac > * { display: block !important; padding-left: 0.3em;  padding-right: 0.3em;}
.mfrac > * + * { /* display: inline-block !important; */ vertical-align: top; }
.mfrac>.fracZi{ /* margin-top: -0.0714em; */}
.fracLine{ height: 1px; border-top: 0.0714em solid;padding: 0 0.3em 0em;/* position: absolute; */width: 100%;left: 0;top: 50%;box-sizing: border-box;}
/* .mfrac>.fracMu{ margin-top: 0.1714em;}
.fracZi{ padding-bottom: 0.1em;}
.fracMu{ padding-top: 0.1em;} */
.mfrac>.fracZi{ padding-bottom: 0.0714em;padding-bottom: 0.214em;}
.mfrac>.fracMu{ padding-top: 0.0714em;position: absolute;left: 50%; transform: translateX(-50%);padding-top: 0.214em;} 

/*倾斜分式结构*/
.frac2 { position: relative; display: inline-block !important; }
.frac2 > .ffront { text-align: right; }
.frac2 > .ffront, .frac2 > .fend { float: left; }
.frac2 > .fline { position: absolute; bottom: 0; left: 0; border-top: 0.067em solid; transform-origin: top left; transform: rotate(-60deg); }

/*不带根数的平方根*/
.msqrt { display: inline-block; position: relative; box-sizing: border-box;text-align: left;  }
.msqrt:after { content: ""; display: block; height: 0; clear: both; }
.msqrtSign { transform-origin: 0 0; display: inline-block; overflow: hidden; vertical-align: top; }
.singleSqrt,.singleRoot { display: block;position: relative; }
.sqrt{position: relative; top: -0.9em;height: 2.6em;left: 0.1em;}
/* .singleRoot {display: block;position: relative;top: -0.13em;   } */
/* .singleRoot.JyeooHai-Main-Regular ,.singleSqrt.JyeooHai-Main-Regular{ line-height: 0.8;left:0.1em} */
.singleRoot.JyeooHai-Main-Regular ,.singleSqrt.JyeooHai-Main-Regular{ line-height: 1.8;left:0.1em;height: 1.17em;}/*20240312*/
.singleRoot.JyeooHai-Size1,.singleSqrt.JyeooHai-Size1{ line-height: 1.2; }
.singleRoot.JyeooHai-Size4,.singleSqrt.JyeooHai-Size4{ line-height: 2.7;}
.msqrt .stretchH { transform-origin: 0 0; border-right: 0.0714em solid; }
.msqrtBox { border-top: solid thin; border-top-width: 0.0714em; padding-top: 0.15em; /* padding-left: 0.15em; */padding-right: 0.15em;  display: inline-block; position: relative; left: -0.01em; }

/*（带指定根数的根号）*/
.mroot { display: inline-block; position: relative; text-align: left; }
.mroot > .mrootExponent { font-size: 0.7em; position: absolute; left: 0.285em; top: -0.6em;z-index: 1; top:0; }
.mroot > .mrootBox { position: relative; display: inline-block; }
.mrootBox > .mrootCont { border-top: solid thin; border-top-width: 0.0714em; padding-left: 0.15em;padding-right: 0.15em; padding-top: 0.15em; display: inline-block; position: relative; }
.mrootBox > .mrootSign { transform-origin: 0 0; overflow: hidden; display: inline-block; vertical-align: top; }
.mrootBox .stretchH { transform-origin: 0 0; border-right: 0.0714em solid; }

/*矩阵表格*/
.mtable { display: inline-block; border-collapse: collapse; margin: 0; padding: 0; vertical-align: middle; text-align: left; line-height: 0; font-size: inherit; *font-size: 100%; _font-size: 100%; font-style: normal; font-weight: normal; border: 0; float: none; display: inline-block; *display: inline; /*zoom: 0;*/ position: relative; }
.mtable tr { margin: 0; padding: 0; }
.mtable td { padding: 0.2em 0.1em; font-size: inherit; line-height: 0; white-space: nowrap; border: 0 none; width: auto; _height: auto; }

/*纵向拉伸符号*/
.MathJye .stretchVBox { display: inline-block; position: relative; }
.MathJye .brace, .MathJye .paren, .MathJye .bracket, .MathJye .bracketAngle, .MathJye .stretchVLine, .MathJye .stretchDBVLine, .MathJye .bracketTHalf, .MathJye .bracketBHalf {position: absolute;top: 0;font-family: 'JyeooHai-Size4'; }
.MathJye .braceL, .MathJye .parenL, .MathJye .bracketL, .MathJye .bracketAngleL, .MathJye .stretchVLineL, .MathJye .stretchDBVLineL, .MathJye .bracketTHalfL, .MathJye .bracketBHalfL { left: 0; }
.MathJye .braceR, .MathJye .parenR, .MathJye .bracketR, .MathJye .bracketAngleR, .MathJye .stretchVLineR, .MathJye .stretchDBVLineR, .MathJye .bracketTHalfR, .MathJye .bracketBHalfR { right: 0; }
.MathJye .vmCont { display: inline-block; }
.MathJye .bracketAngleParent { vertical-align: baseline; display: inline-block; }
.MathJye .stretchVBox .size2,.MathJye .stretchVBox .size3,.MathJye .stretchVBox .size4{ line-height: 2.25; }
.MathJye .bracketAngle .size4{ line-height: 3; }
/*花括号*/
.MathJye .brace, .MathJye .paren { font-family: 'JyeooHai-Size4'; transform-origin: top; }
.MathJye .brace1 { height: 0.85em; line-height: 1.25; }
.MathJye .brace2{ overflow: hidden;}
.MathJye .brace2 span{ display: block; height: 0.4em; line-height: 0.9em; transform: scaleY(10000);}
.MathJye .brace3 { height: auto; line-height: 1.2; height: 1.4em; }
.MathJye .brace4 { height: 1.2143em; line-height: 0.1; margin-top: -0.5em; }
.MathJye .size4 { font-family: 'JyeooHai-Size4'; }
.MathJye .size3 { font-family: 'JyeooHai-Size3'; }
.MathJye .size2 { font-family: 'JyeooHai-Size2'; }
.MathJye .size1 { font-family: 'JyeooHai-Size1'; line-height: normal;}
/*圆括号*/
.MathJye .parenTop { line-height: 1.95; height: 1.75em; transform: scaleY(1.05); }
.MathJye .parenMid { overflow: hidden;}
.MathJye .parenMid span{display: block; height: 0.4em; line-height: 0.9em; transform: scaleY(10000);}
.MathJye .parenBtm { line-height: 1.5; height: 1.7em; }
/*垂直竖线括号、垂直竖线半括号*/
.MathJye .bracketTop, .bracketTHalf .bracketHalfSign {line-height: 1.88;height: 1.7em;}
.MathJye .bracketTop{ height: 1.7em;}
.MathJye .bracketMid, .MathJye .bracketTHalfMid { line-height: 1.98; height: 1.2143em; overflow: hidden; }
.MathJye .bracketTHalfMid span{display: block; height: 0.4em; line-height: 0.9em; transform: scaleY(10000);}
.MathJye .bracketMid { overflow: hidden; }
.MathJye .bracketMid  span{display: block; height: 0.4em; line-height: 0.9em; transform: scaleY(10000);}
.MathJye .bracketBtm, .bracketBHalf .bracketHalfSign {line-height: 1.70em;height: 1.75em; }
.MathJye .bracketTHalf, .MathJye .bracketBHalf { /* overflow: hidden; */ }
.MathJye .bracketBHalf { display: inline-flex; flex-direction: column; justify-content: flex-end; }
/*尖括号*/
.MathJye .bracketAngle > div { transform-origin: top; }

/*垂直竖线*/
.stretchVLine, .stretchDBVLine { border-right: 0.0814em solid; margin-left: 0.2143em; margin-right: 0.2143em; }
/*垂直双竖线*/
.stretchDBVLine { position: relative; padding-left: 0.3343em; }
.stretchDBVLine:before { content: ''; position: absolute; left: 0; top: 0; border-right: 0.0814em solid; height: 100%; }

/*上、下、上下角标对*/
.msubsup { position: relative; display: inline-block; box-sizing: border-box;text-align: left; }
.msubsup > * { display: inline-block; }
.msubsup > .msup, .msubsup > .msub { font-size: 0.8em; }
.msubsup > .msup { vertical-align: 0; position: relative; }

/*上角标  单字符延展*/
.msupComma{ height: 0.2em;line-height: 0.9em;}

/*上标mover*/
.mover { display: inline-block; text-align: center; }
.mover > .over { font-size: 0.7em; }
.mover > .over, .mover > .base { display: block; }

/*上标字符*/
.mover > .over > .character { }
.mover > .over > .character > span { transform: scale(1,1); transform-origin: center; display: inline-block; }
.mover > .over > .arc { line-height: 0.6; }
.mover > .over > .arc > span { width: 0.98em; font-size: 1.5em; line-height: 0.5em; }
.mover > .over > .hat { height: 0.65em; line-height: 2.3; position: relative; top: 0.3em; }
.mover > .over > .hat > span {font-size: 2em; line-height: 0.01em; font-family: 'JyeooHai-Size1'; }
.mover > .over > .wave { height: 0.8em; line-height: 3em; }
.mover > .over > .wave > span { font-size: 2.2em; width: 0.35em; margin-left: -0.1em; font-family: 'JyeooHai-Size1'; }
.mover > .over > .tline{ padding-bottom: 0.18em;}
/*上标、下标宝盖头拉伸*/
.mover > .over > .gai { font-size: 2.2em; height: 0.6em; overflow: hidden; text-align: left; position: relative; font-family: 'JyeooHai-Size1'; }
.mover > .over > .gai > span { vertical-align: top; height: 0.4em; display: inline-block; }
.mover > .over > .gai > .minus { transform: scale(500,1);  }
.mover > .over > .gai > .gaiL, .munder > .under > .gai > .gaiL { width: 0.45em; position: absolute; left: -0.13em; }
.mover > .over > .gai > .gaiR, .munder > .under > .gai > .gaiR { position: absolute; right: -0.17em; }
.munder > .under > .gai > .minus { transform: scale(500,1); }

.baseCont { display: inline-block; }
/*上标、下标花括号拉伸*/
.mover > .over > .braceHorizontal, .munder > .under > .braceHorizontal { font-family: 'JyeooHai-Size4'; letter-spacing: -0.03em; margin-left: -0.03em; font-size: 1.5em; line-height: 0.48em; padding-bottom: 0.2em; height: 0.48em; }
.mover > .over > .braceHorizontal > *, .munder > .under > .braceHorizontal > *, .overBraceV { display: inline-block; vertical-align: top; height: 0.7em; overflow: hidden; }
.braceHorizontal > .stretchBox { overflow: hidden; }
.braceHorizontal > .stretchBox > .overBraceV { transform: scaleX(500); }

/*下标munder*/
.munder { display: inline-block; text-align: center; position: relative; }
.munder > .under { font-size: 0.7em; left: 50%; position: absolute; transform: translateX(-50%); }
/*下标字符*/
.munder > .under > .gai { font-size: 2.2em;line-height: 0.21em;height: 0.4em; text-align: left; overflow: hidden; font-family: 'JyeooHai-Size1'; }
.munder > .under > .gai > span { }
.munder > .under > .gai > .minus { display: inline-block; }
.munder > .under > .gai > .gaiL { }
.munder > .under > .gai > .gaiR { }
.munder > .under > .tline{ padding-top: 0.25em;}

/*上下标munderorder*/
.munderorder { display: inline-block; text-align: center; position: relative; }
.munderorder > .munderorderTop, .munderorder > .munderorderBtm { font-size: 0.7em; position: absolute; left: 50%; transform: translateX(-50%); }
.munderorderTop { top: 0; }
.munderorderMid>*{display: block !important;}

/*上标、下标拉伸字符*/
.mover > .over > .tline > div, .munder > .under > .tline > div { border-top: 0.0814em solid;width: 90%;margin: auto; }
.mover > .over > .tlineDouble > div, .munder > .under > .tlineDouble > div { border-top: 0.0814em solid; padding-top: 0.15em; }

/*箭头*/
.stretchArrow > .arrow,.stretchArrow{ font-family:'JyeooHai-Arrow' ;}
.stretchArrow, .stretchArrow { font-size: 1.8em; line-height: 0.7em; overflow: hidden; text-align: left; position: relative; }
.over .stretchArrow,.over .stretchArrow {top: 0; line-height: 0.35em; }
.under .stretchArrow,.under .stretchArrow {/* top: -0.2em; */line-height: 0.35em;  }
.stretchArrowHalf, .stretchArrowHalf { line-height: 0.4em; }
.stretchArrow > .arrowR { position: absolute; right: -0.11em; top:0em; }
.stretchArrow > .arrowL { position: absolute; left: -0.08em;top:0em; }
.stretchArrow > .stretchArrowLine { transform: scale(5000,1); display: inline-block; font-family: 'JyeooHai-Size1'; }
.stretchPdLR { padding-left: 1.5em; padding-right: 1.5em; }
.stretchArrowNormal { font-size: 1.75em; min-width: 1em; min-height: 0.5em;line-height: 0.35em; margin-top:0.1em; }
.stretchArrowShort { margin: 0 auto; min-width: 2em; }
.stretchArrowLR { min-width: 0.6em; }

/*特殊符号*/
/*固定上标-*/
.mover > .over > .overDot { height: 0.2em; font-size: 2.5em; line-height: 1.3em; }

/*固定下标*/
.munder > .under > .underDot { height: 0.2em; font-size: 2.5em; line-height: 1.75em;margin-top: 0.05em;}
.munder > .under > .underHat { height: 0.8714em; margin-top: 0; line-height: 1.5; }
.munder > .under > .underArrow { height: 0.8857em; font-size: 1.3em; margin-top: -0.3572em; }

/*menclose*/
.menclose { display: inline-block; text-align: left; position: relative; }
.menclose > .box { padding: 0.267em; }
.menclose > .box-lt { border-top: 0.067em solid; border-left: 0.067em solid; padding-top: 0.2em; padding-left: 0.2em; }
.menclose > .box-tr { border-top: 0.067em solid; border-right: 0.067em solid; padding-top: 0.2em; padding-right: 0.2em; }
.menclose > .box-lb { border-bottom: 0.067em solid; border-left: 0.067em solid; padding-bottom: 0.2em; padding-left: 0.2em; }
.menclose > .box-br { border-bottom: 0.067em solid; border-right: 0.067em solid; padding-right: 0.2em; padding-bottom: 0.2em; }
.menclose > .box-around { padding: 0.2em; border: 0.067em solid; }
.menclose > .box.box-hstrike { padding: 0 0.267em; }
.menclose > .strike { left: 0; position: absolute; border-top: 0.067em solid; }
.menclose > .ustrike { bottom: 0; transform-origin: bottom left; }
.menclose > .dstrike { top: 0; transform-origin: top left; }
.menclose > .hstrike { border-top: 0.07em solid; position: absolute; left: 0; right: 0; bottom: 50%; transform: translateY(0.034em); }
.menclose > .sqrt-box { display: inline-block; border-top: 0.067em solid; padding: 0.267em 0.2em 0.2em 0.433em; }
.menclose > .dbox { position: absolute; top: 0; bottom: 0; left: -0.3em; width: 0.6em; border: 0.067em solid; border-radius: 50%; clip-path: inset(0 0 0 0.3em); box-sizing: border-box; }

/*求和公式组合*/
.sum { font-family: 'JyeooHai-Size2'; line-height: 1.5em; }
/*积分组合  */
.integral { font-family: 'JyeooHai-Size1'; font-size: 1.7em; line-height: 1.2;}

/*火狐浏览器hack处理*/
@-moz-document url-prefix() {
    .stretchArrow > .arrowR{top: -0.02em;}
}
/*chrome 可编辑公式显示蓝色*/
@keyframes blink {
    0% {
        border-color: #fff;
    }

    50% {
        border-color: transparent;
    }

    100% {
        border-color: blue;
    }
}

.MathJye-Active {
    border: 2px solid blue;
    animation: blink 1s ease infinite;
}

.MathJye[latex] {
    color: blue;
    cursor: pointer;
}`;

    // ── 站点描述层 ────────────────────────────────────────────────────────────
    // 把各站点的选择器差异收敛到一处：新增站点只需追加一个 profile，预览/分页/版式等逻辑完全复用。
    // 菁优网「组卷中心」与「试卷详情」题目结构同构（li.QUES_LI > fieldset.quesborder > .pt1/.pt2），共用同一 profile。
    const SITE_PROFILES = {
        xkw: {
            id: 'xkw',
            label: '组卷网',
            hasAnswers: true,
            // 空卷判定用的题目根
            questionRootSel: '.tk-quest-item.quesroot',
            // 标题 + 题目根混合遍历（按文档顺序）
            sourceNodesSel: '.sec-title, .questype-head .questypetitle, .tk-quest-item.quesroot',
            // 章节/题型标题提取器（与题目根同队列遍历）
            sectionTitles: [
                { sel: '.sec-title', get: n => { const e = n.querySelector('span'); return e ? e.textContent.trim() : ''; } },
                { sel: '.questypetitle', get: n => {
                    const idx = n.querySelector('.questypeindex');
                    const name = n.querySelector('.questypename');
                    return ((idx ? idx.textContent : '') + (name ? name.textContent : '')).trim();
                } },
            ],
            // 题目内容源（相对题目根）
            contentRootSel: '.wrapper.quesdiv',
            // 题目体组成部分（按顺序克隆进题目体）
            bodyPartSels: ['.exam-item__cnt'],
            // 是否直接克隆内容源整块（保留 quesborder 等祖先 class，提高站点公式 CSS 选择器命中率）
            useContentRootAsBody: false,
            // 原站题号节点（存在则按元素删除，且不再做文本剥离）
            numberStripSel: null,
            // 选项/答案容器与答案块
            optionSel: '.exam-item__opt',
            answerSel: '.item.answer',
            // 需从克隆内容中剔除的原站工具栏
            stripSels: [],
            // 排除区域（如已删除题目分区）
            excludeClosestSel: '.deleted-box',
            // 显式答案开关
            answerSwitchSel: '#isshowAnswer, .tklabel-checkbox.show-answer input',
            // 答案/知识点均取自当前页面 DOM，无需抓取单题页
            detailFetch: false,
            // 公式形态：svg-image=图片化 SVG（需冻结尺寸）；html-css=HTML+CSS 排版（需注入站点公式样式）
            formulaKind: 'svg-image',
            formulaCssHints: [],
        },
        jyeoo: {
            id: 'jyeoo',
            label: '菁优网',
            // 菁优网的答案与考点只存在于「单题页」，且由页面 JS 渲染，需异步抓取（见 fetchAllSiteDetails）
            hasAnswers: true,
            hasKnowledge: true,
            detailFetch: true,
            // 题目元素内指向单题页的链接（组卷中心是「查看解析」，试卷详情页是「解析」）
            detailLinkSel: 'a[href*="/math/ques/detail/"]',
            // 答案 = 单题页的【答案】【分析】【解答】
            detailAnswerSels: ['.pt11', '.pt5', '.pt6'],
            // 知识点 = 单题页的【考点】
            detailKnowledgeSel: '.pt3',
            // 卷名：菁优网组卷中心用 #exam-title / .exam-title；h1 退到最后避免取到站点 logo
            paperTitleSels: ['#exam-maintitle', '.exam-maintitle', '.paper-title', '.paper-name', '.exam-title', 'h1'],
            questionRootSel: 'li.QUES_LI',
            sourceNodesSel: '.questypehead .questypetitle, h3.ques-type, li.QUES_LI',
            sectionTitles: [
                { sel: '.questypetitle', get: n => (n.textContent || '').trim() },
                { sel: 'h3.ques-type', get: n => (n.textContent || '').trim() },
            ],
            contentRootSel: 'fieldset.quesborder',
            bodyPartSels: ['.pt1', '.pt2'],
            // 菁优网整块克隆 fieldset.quesborder：站点公式 CSS 常带 .quesborder 等祖先前缀
            useContentRootAsBody: true,
            numberStripSel: 'span.qseq',
            optionSel: null,
            answerSel: null,
            // .fieldtip：题目工具栏；.sanwser：标准答案容器（组卷中心为空，试卷详情页会填入答案，不打印）；
            // .quizPutTag：填空位标记，保留不影响显示。
            stripSels: ['.fieldtip', '.sanwser'],
            excludeClosestSel: '#divDeleteQues',
            answerSwitchSel: null,
            formulaKind: 'html-css',
            builtinFormulaCss: JYEOO_FORMULA_CSS,
            // 菁优网自研 MathJye 引擎：公式为 div/span + class 排版，需把原站对应 CSS 注入预览
            formulaCssHints: ['MathJye', 'mrow', 'mfrac', 'fracZi', 'fracMu', 'fracLine', 'msqrt',
                'msqrtSign', 'msqrtBox', 'singleSqrt', 'msubsup', 'msubsupCont', 'math-letter',
                'JyeooHai', 'mnormal', 'msub', 'msup'],
        },
    };

    // 单题页抓取缓存：key = 单题页 URL → { answerHtml, kpHtml }，失败存 null。
    // 菁优网的答案/考点只存在于单题页且由页面 JS 渲染，服务端 HTML 里没有可用内容，
    // 故用隐藏 iframe 加载、等 MathJye 渲染完成后再从同源 iframe 内提取。
    const _siteDetailCache = new Map();
    // 站点详情缓存版本：脚本更新后旧缓存自动失效重抓（修复旧版本可能缓存的部分渲染内容无法自愈）。
    // partial 标记：8 秒保底提取时公式未全部渲染完成的内容，下次点「获取答案」会重抓。
    const SITE_DETAIL_CACHE_VER = 2;
    function _siteDetailGet(url) {
        if (!url) return null;
        const cached = _siteDetailCache.get(url);
        return (cached && cached.ver === SITE_DETAIL_CACHE_VER) ? cached : null;
    }

    // 站点公式样式缓存：key = `${profile.id}@${origin}` → 已提取的公式 CSS 文本。
    // 菁优网等 HTML+CSS 公式引擎的样式可能位于跨域样式表，cssRules 会因 CORS 抛错读不到，
    // 故改用「读文档内 <style> 文本 + GM_xmlhttpRequest 拉取 link 文本」再按关键词提取规则。
    const _siteCssCache = new Map();
    function siteCssCacheKey(profile) { return `${profile.id}@${location.origin}`; }

    // 把 CSS 中的相对 url() 绝对化。站点公式 CSS 位于跨域 CDN，字体用相对路径引用，
    // 直接把 CSS 注入预览（srcdoc）会让相对路径解析到错误位置 → 字体加载失败 → 公式错位。
    function absolutizeCssUrls(cssText, baseUrl) {
        if (!cssText) return '';
        try {
            return String(cssText).replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/g, (whole, quote, rawUrl) => {
                const target = (rawUrl || '').trim();
                if (!target) return whole;
                if (/^(data:|https?:|\/\/|#)/i.test(target)) return whole;
                try { return 'url(' + quote + new URL(target, baseUrl).href + quote + ')'; }
                catch (e) { return whole; }
            });
        } catch (e) { return cssText; }
    }

    function gmFetchText(url) {
        return new Promise(resolve => {
            try {
                if (typeof GM_xmlhttpRequest !== 'function') return resolve('');
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: 8000,
                    onload: res => resolve((res && res.responseText) || ''),
                    onerror: () => resolve(''),
                    ontimeout: () => resolve(''),
                });
            } catch (e) { resolve(''); }
        });
    }

    // 公式 CSS 抓不到时的最小兜底：至少让公式元素水平排列，避免逐行堆叠。
    // 兜底样式只在「线上公式样式抓取失败」时启用。
    // 注意：这里只补 display，绝不设置 vertical-align —— MathJye 自身用 baseline，
    // 覆盖成 middle 会让公式（尤其分数）垂直错位。
    // MathJye 修正规则的统一作用域：公式不只出现在题干（.zujuanjs-question-body），
    // 答案附末尾/内联答案挂在 .zujuanjs-answer-item（内含 .zujuanjs-site-answer），
    // 考点挂在 .zujuanjs-knowledge-points。此前只限定题干容器，
    // 导致「题干公式正常、答案区公式错位/粘连」（batch75 根因）。
    const MATHJYE_CONTAINER_SEL = ':is(.zujuanjs-question-body, .zujuanjs-answer-item, .zujuanjs-knowledge-points, .zujuanjs-site-answer)';
    const SITE_FORMULA_FALLBACK_CSS = `
        ${MATHJYE_CONTAINER_SEL} .MathJye { display: inline-block; }
        ${MATHJYE_CONTAINER_SEL} .mrow { display: inline-block; }
        ${MATHJYE_CONTAINER_SEL} .mo, ${MATHJYE_CONTAINER_SEL} .math-letter,
        ${MATHJYE_CONTAINER_SEL} .msub, ${MATHJYE_CONTAINER_SEL} .msup,
        ${MATHJYE_CONTAINER_SEL} .msubsup, ${MATHJYE_CONTAINER_SEL} .msubsupCont,
        ${MATHJYE_CONTAINER_SEL} .mnormal { display: inline-block; }
    `;

    // 站点补充样式：原站部分排版依赖其全局 CSS，克隆进预览后需补齐关键规则。
    // 菁优网：题目内链接（题源标注）不显示为蓝色下划线；题干/选项块与选项表格恢复块级布局。
    const SITE_EXTRA_CSS = {
        xkw: '',
        jyeoo: `
            /* 题源标注等链接沿用站点配色（站点规则：a { color: #008afb; text-decoration: none; }），
               此前为打印观感强制继承正文色，现按需求恢复站点颜色。 */
            /* 题源标注（a.ques-source）沿用站点链接色 */
            .zujuanjs-question-body a.ques-source,
            .zujuanjs-question-body a.ques-source:link,
            .zujuanjs-question-body a.ques-source:visited,
            .zujuanjs-question-body a.ques-source:hover,
            .zujuanjs-question-body a.ques-source:focus,
            .zujuanjs-question-body a.ques-source:active { color: #008afb !important; }
            /* 其余链接（如考点名、答案区解析里的链接）按正文展示，不可点、不变色。
               答案 HTML 抓自单题页，内含大量站内链接，作用域需覆盖答案/考点容器。 */
            ${MATHJYE_CONTAINER_SEL} a,
            ${MATHJYE_CONTAINER_SEL} a:link,
            ${MATHJYE_CONTAINER_SEL} a:visited,
            ${MATHJYE_CONTAINER_SEL} a:hover,
            ${MATHJYE_CONTAINER_SEL} a:focus,
            ${MATHJYE_CONTAINER_SEL} a:focus-visible,
            ${MATHJYE_CONTAINER_SEL} a:active,
            ${MATHJYE_CONTAINER_SEL} a * {
                color: inherit !important;
                text-decoration: none !important;
                background-color: transparent !important;
                border-bottom: none !important;
                box-shadow: none !important;
                /* 预览里的链接不可点击，去掉手型光标，避免悬浮时鼠标样式变化 */
                cursor: default !important;
            }
            .zujuanjs-question-body .pt1, .zujuanjs-question-body .pt2 { display: block; }
            .zujuanjs-question-body fieldset.quesborder { border: none !important; margin: 0 !important; padding: 0 !important; min-width: 0 !important; }
            .zujuanjs-question-body fieldset.quesborder > legend { display: none !important; }
            /* 只隐藏内容源 fieldset 里的空占位；单题页的 .pt6 是【解答】、答案块里必须保留，
               故把隐藏范围限定在 fieldset.quesborder 内。 */
            .zujuanjs-question-body fieldset.quesborder .pt2_area,
            .zujuanjs-question-body fieldset.quesborder .pt6 { display: none; }
            .zujuanjs-question-body .pt2 table.ques { border-collapse: collapse; width: 100%; }
            .zujuanjs-question-body .pt2 td.selectoption { padding: 2px 12px 2px 0; vertical-align: middle; }
            /* 注意：不要对公式子树强制 box-sizing。MathJye 对 .mo/.fracLine/.math-letter 等
               显式声明了 border-box，通配符强制 content-box 会破坏分数线宽度计算。
               以下公式修正规则统一使用 MATHJYE_CONTAINER_SEL 作用域：
               答案区（附末尾/内联）的公式与题干是同一套 MathJye DOM，
               限定题干容器会让答案区公式完全吃不到修正（batch75 根因）。 */
            /* MathJye 渲染时会把测量出的像素宽度写进 .mfrac（如 width: 39px），而分数线是 .fracLine{width:100%}。
               预览中字形宽度与原站存在细微差异时，分子会溢出固定宽度并与分数线错位；
               改为由内容撑开宽度并强制居中，分子/分数线/分母即可自动对齐。 */
            ${MATHJYE_CONTAINER_SEL} .mfrac { width: auto !important; text-align: center !important; }
            /* MathJye 内部大量使用按 14px 字号测量出的固定 px，字号被外层改变会导致整体失配，故锁定。 */
            ${MATHJYE_CONTAINER_SEL} .MathJye { font-size: 14px !important; line-height: 0 !important; }
            /* 注：.mfrac > * 的左右 0.3em 内边距是站点原生设定（分子/分母与分数线两端留白），
               不要移除 —— 移除虽能让分数线与分子内容严格等宽，但会偏离站点排版。 */
            /* 分子底部留呼吸：站点实测 .fracZi 高 12px（比字形自身高 1px），
               而它带内联 height（如 11px）在 border-box 下会压掉这 1px，导致字形底部与分数线视觉粘连。
               这里改为按内容撑开并补 3px，恢复站点那种轻微间隙。 */
            ${MATHJYE_CONTAINER_SEL} .mfrac > .fracZi { height: auto !important; padding-bottom: 3px !important; }
            ${MATHJYE_CONTAINER_SEL} .fracZi,
            ${MATHJYE_CONTAINER_SEL} .fracMu { text-align: center !important; }
            ${MATHJYE_CONTAINER_SEL} .qseq { display: none; }
            /* 站点 style_www.css 中与公式/题目装饰相关的规则（原本随该文件一起注入，
               现因该文件含 .quesborder 字体族与 font-size 会覆盖预览设置而不再整份引入，故按需补回）。 */
            ${MATHJYE_CONTAINER_SEL} .mathjye-bold { font-weight: 800; }
            ${MATHJYE_CONTAINER_SEL} .mathjye-del { text-decoration: line-through; }
            ${MATHJYE_CONTAINER_SEL} .mathjye-underline { border-bottom: 1px solid #000; padding-bottom: 2px; min-width: 2em; min-height: 1em; display: inline; }
            ${MATHJYE_CONTAINER_SEL} .mathjye-underpline { border-bottom: 2px dotted #000; padding-bottom: 3px; }
            ${MATHJYE_CONTAINER_SEL} .mathjye-underpoint { background: url(https://img.jyeoo.net/images/formula/point.png) no-repeat center bottom; padding-bottom: 4px; }
            ${MATHJYE_CONTAINER_SEL} .mathjye-underpoint2 { background: url(https://img.jyeoo.net/images/formula/dot.png) repeat-x 0 18px; padding-bottom: 2px; }
            ${MATHJYE_CONTAINER_SEL} .flipv { transform: scaleX(-1); }
            ${MATHJYE_CONTAINER_SEL} .fliph { transform: scaleY(-1); }
            /* 答案/解析块照搬站点原生排版（jye-root-3.0.css）：
               .pt3/.pt4/.pt5/.pt6/.pt7/.pt11 用 padding-left:80px 让正文整体缩进，
               其 em（【考点】【答案】【分析】【解答】等标签）绝对定位贴左、加粗、不斜体，
               形成「标签在左、正文缩进」的悬挂排版；题干 .pt1 内的 em 恢复常规流。
               选择器不再限定容器：这些块可能出现在 .zujuanjs-site-answer（答案）、
               .zujuanjs-knowledge-points（考点）或内容源 fieldset 中，限定容器会漏掉其中之一。
               注意不要包含 .pt1/.pt2（题干与选项），避免影响正文自身的 em。 */
            #source-content :is(.pt3, .pt4, .pt5, .pt6, .pt7, .pt11),
            #paper-container :is(.pt3, .pt4, .pt5, .pt6, .pt7, .pt11) {
                clear: both;
                position: relative;
                padding: 0 20px 20px 80px;
            }
            #source-content :is(.pt3, .pt4, .pt5, .pt6, .pt7, .pt11) em,
            #paper-container :is(.pt3, .pt4, .pt5, .pt6, .pt7, .pt11) em {
                font-style: normal;
                font-weight: 600;
                color: #1677ff;      /* 与组卷网【知识点】标签同色 */
                position: absolute;
                left: 20px;
            }
            /* 题干内的 em（多为数学符号）恢复常规流与继承色，不被上面的标签样式影响 */
            #source-content fieldset.quesborder .pt1 em,
            #paper-container fieldset.quesborder .pt1 em {
                position: static;
                color: inherit;
                font-weight: inherit;
            }

            /* 内联答案块左边缘对齐到题干列（题号列宽 2.4em + 列间距），
               使其与题干下方同属题干列的【考点】左对齐。
               用 margin 而非 padding：预览内为 content-box，padding 会让宽度溢出被裁。 */
            #source-content .zujuanjs-inline-answer,
            #paper-container .zujuanjs-inline-answer {
                margin-left: calc(2.4em + var(--number-gap, 0.55em));
            }

            /* 填空位（试卷详情/组卷中心填空题题干内的 div.quizPutTag）：
               站点在 jye-root-3.0.css 里用 border-bottom 画填空横线，并靠 inline-block 让后面的标点同行。
               缺失时会退化为块级元素 —— 横线消失、句号被挤到下一行。 */
            ${MATHJYE_CONTAINER_SEL} div.quizPutTag {
                display: inline-block;
                padding: 3px 10px 1px 10px;
                margin: 0 3px;
                font-size: inherit;
                min-width: 1em;
                min-height: 16px;
                line-height: 18px;
                height: auto;
                border-bottom: 1px solid #0033FF;
                color: #127176;
                text-decoration: none;
                word-break: break-all;
            }
            .zujuanjs-question-body div.quizPutTag img { cursor: pointer; margin-left: 10px; max-width: 200px; }
            .zujuanjs-question-body .id-blank { display: inline-block; width: 24px; font-size: 14px; font-weight: bold; line-height: 16px; }
            .zujuanjs-question-body table.edittable { border-collapse: collapse; margin: 2px; }
            .zujuanjs-question-body table.edittable th,
            .zujuanjs-question-body table.edittable td { border: 1px solid #000; padding: 5px; vertical-align: middle; }
        `,
    };

    // 站点识别：菁优网各子域共用同一 profile；其余按组卷网处理（历史行为不变）。
    function getSiteProfile() {
        const host = (location.hostname || '').toLowerCase();
        if (host === 'jyeoo.com' || host.endsWith('.jyeoo.com')) return SITE_PROFILES.jyeoo;
        return SITE_PROFILES.xkw;
    }

    // 下拉选项单一来源：编辑器面板中的字体/字号/行距/页码字号下拉复用，避免与已删除的 get* 函数重复、改一处漏另一处。
    const FONT_OPTIONS = [
        { value: '"Times New Roman", SimSun, "Songti SC", serif', text: '宋体 + 新罗马' },
        { value: 'SimSun, "Songti SC", serif', text: '宋体' },
        { value: '"Microsoft YaHei", "PingFang SC", sans-serif', text: '微软雅黑' },
        { value: 'SimHei, "PingFang SC", sans-serif', text: '黑体' },
        { value: 'KaiTi, "Songti SC", serif', text: '楷体' },
        { value: 'FangSong, "Songti SC", serif', text: '仿宋' },
        { value: '"Noto Serif SC", "Times New Roman", serif', text: '思源宋体' },
        { value: '"Noto Sans SC", "PingFang SC", sans-serif', text: '思源黑体' }
    ];
    const SIZE_OPTIONS = [
        { value: '14px', text: '14px' }, { value: '15px', text: '15px' },
        { value: '16px', text: '16px' }, { value: '17px', text: '17px' },
        { value: '18px', text: '18px' }, { value: '20px', text: '20px' }, { value: '22px', text: '22px' }
    ];
    const LINE_HEIGHT_OPTIONS = [
        { value: '1.2', text: '1.2 · 紧凑' }, { value: '1.35', text: '1.35' },
        { value: '1.5', text: '1.5 · 标准' }, { value: '1.75', text: '1.75' }, { value: '2.0', text: '2.0 · 宽松' }
    ];
    const PAGE_SIZE_OPTIONS = [
        { value: '10px', text: '10px' }, { value: '12px', text: '12px' },
        { value: '14px', text: '14px' }, { value: '16px', text: '16px' }, { value: '18px', text: '18px' }
    ];
    function buildSelectOptions(options) {
        // 选项值含双引号，用单引号包裹属性值以安全嵌入（值内不含单引号）。
        return options.map(o => `<option value='${o.value}'>${o.text}</option>`).join('');
    }

    // 版式预设单一来源（X5.2）：原定义在 iframe 内，现上提到父窗口，序列化进 previewSettingsJson 注入，
    // iframe 直接复用，避免改父窗口默认值却漏改 iframe 双源不一致。
    const LAYOUT_PRESETS = Object.freeze({
        exam: {
            label: '考试标准',
            settings: {
                font: '"Times New Roman", SimSun, "Songti SC", serif', size: '16px', lineHeight: '1.5',
                titleSize: '24px', pageFont: '"Times New Roman", SimSun, "Songti SC", serif', pageSize: '12px',
                pageBold: true, showPageNumber: true, pageMargins: '18,15,22,15', questionSpacing: '10',
                paragraphSpacing: '8', contentAlign: 'left', numberGap: '0.55', pageGap: '20',
                previewLayout: 'double', previewZoom: 'auto'
            }
        },
        'word-normal': { label: 'Word 普通', settings: { pageMargins: '25.4,25.4,25.4,25.4' } },
        'word-narrow': { label: 'Word 窄', settings: { pageMargins: '12.7,12.7,12.7,12.7' } },
        'word-moderate': { label: 'Word 适中', settings: { pageMargins: '25.4,19.05,25.4,19.05' } },
        'word-wide': { label: 'Word 宽', settings: { pageMargins: '25.4,50.8,25.4,50.8' } },
        compact: { label: '紧凑省纸', settings: { pageMargins: '12,12,16,12', questionSpacing: '4', paragraphSpacing: '4', lineHeight: '1.35' } }
    });

    // 预览设置声明式 schema：集中管理「设置键 → 存储键 → 默认值 → 类型」，
    // getPreviewSettings / savePreviewSettings 据此统一读写，消除数十行重复罗列与类型判断。
    // type 取值：str(原样) | csv(逗号分隔数组) | boolStr(String!=='false') | boolObj(Boolean) | title(动态取卷名) | pageFont(回退font)
    const PREVIEW_SETTING_SCHEMA = [
        { key: 'contentFlags',    storage: 'printContentFlags', def: 'q',             type: 'csv' },
        { key: 'answersAtEnd',    storage: 'printAnswersAtEnd', def: false,           type: 'boolStr' },
        { key: 'font',            storage: 'questionFont',      def: DEFAULT_FONT,    type: 'str' },
        { key: 'size',            storage: 'questionSize',      def: '16px',          type: 'str' },
        { key: 'lineHeight',      storage: 'questionLineHeight',def: '1.35',          type: 'str' },
        { key: 'title',           storage: null,                def: null,            type: 'title' },
        { key: 'titleSize',       storage: 'titleSize',         def: '24px',          type: 'str' },
        { key: 'pageFont',        storage: 'pageFont',          def: null,            type: 'pageFont' },
        { key: 'pageSize',        storage: 'pageSize',          def: '12px',          type: 'str' },
        { key: 'pageBold',        storage: 'pageBold',          def: true,            type: 'boolStr' },
        { key: 'showPageNumber',  storage: 'showPageNumber',    def: true,            type: 'boolObj' },
        { key: 'pageMargins',     storage: 'pageMargins',       def: '12,12,16,12',   type: 'str' },
        { key: 'layoutPreset',    storage: 'layoutPreset',      def: 'compact',       type: 'str' },
        { key: 'questionSpacing', storage: 'questionSpacing',   def: '4',             type: 'str' },
        { key: 'previewLayout',   storage: 'previewLayout',     def: 'double',        type: 'str' },
        { key: 'previewZoom',     storage: 'previewZoom',       def: 'auto',          type: 'str' },
        { key: 'paragraphSpacing',storage: 'paragraphSpacing',  def: '4',             type: 'str' },
        { key: 'contentAlign',    storage: 'contentAlign',      def: 'left',          type: 'str' },
        { key: 'numberGap',       storage: 'numberGap',         def: '0.55',          type: 'str' },
        { key: 'pageGap',         storage: 'pageGap',           def: '20',            type: 'str' },
        { key: 'baseAnswerLinesByType', storage: 'baseAnswerLinesByType', def: '{"objective":0,"judge":0,"fill":0,"conceptFill":0,"solution":0}', type: 'str' },
        { key: 'editorPanelWidth',storage: 'editorPanelWidth',  def: '340',           type: 'str' },
        { key: 'editorPanelTab',  storage: 'editorPanelTab',    def: 'document',      type: 'str' },
        { key: 'editorOpen',      storage: 'editorOpen',        def: true,            type: 'boolStr' },
    ];

    function coerceSetting(type, stored, def) {
        switch (type) {
            case 'csv': {
                const raw = stored == null || stored === '' ? def : stored;
                return String(raw).split(',').filter(Boolean);
            }
            case 'boolStr': return String(stored) !== 'false';
            case 'boolObj': return Boolean(stored);
            default: return stored == null ? def : stored;
        }
    }

    // ==========================================
    // 全局样式
    // ==========================================
    GM_addStyle(`
        .zujuanjs-float-print-btn {
            position: fixed !important; top: 110px !important; right: 30px !important;
            height: 34px !important; padding: 0 15px !important; border-radius: 5px !important;
            background: #1677ff !important; color: #fff !important; border: none !important;
            cursor: pointer !important;
            z-index: 99999 !important; display: inline-flex !important; align-items: center !important;
            justify-content: center !important; transition: background 0.2s ease !important; font-size: 14px !important; font-weight: 500 !important; line-height: 34px !important;
        }
        .zujuanjs-float-print-btn:hover { background: #0f68df !important; }

        .zujuanjs-float-print-btn:active { background: #0d5bc0 !important; }
        .zujuanjs-float-print-btn-icon { margin-right: 6px; display: inline-flex !important; align-items: center !important; }
        .zujuanjs-float-print-btn-text { display: inline; }

        /* ===== 打印设置对话框 - 紧凑布局 ===== */
        .print-dialog-container { text-align: left; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 0 2px; }
        .print-dialog-section { margin-bottom: 14px; }
        .print-dialog-section:last-child { margin-bottom: 0; }
        .print-dialog-label { display: block; font-size: 13px; font-weight: 600; color: #1f1f1f; margin-bottom: 8px; }
        .print-dialog-input {
            width: 100%; height: 36px; padding: 0 12px; border: 1px solid #d9d9d9;
            border-radius: 6px; font-size: 13px; outline: none; transition: all 0.2s; box-sizing: border-box;
        }
        .print-dialog-input:focus { border-color: #1677ff; box-shadow: 0 0 0 2px rgba(22,119,255,0.15); }

        .print-option-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .print-option-card {
            display: flex; align-items: center; gap: 6px; padding: 8px 12px;
            border: 1px solid #e8e8e8; border-radius: 6px; cursor: pointer; background: #fafafa; transition: all 0.2s ease;
        }
        .print-option-card:hover { background: #f0f5ff; border-color: #91caff; }
        .print-option-card.active { background: #e6f4ff; border-color: #1677ff; }
        .print-option-card input[type="radio"] { width: 14px; height: 14px; margin: 0; accent-color: #1677ff; flex-shrink: 0; }
        .print-option-card span { font-size: 12px; color: #434343; }

        .print-row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .print-field { min-width: 0; }
        .print-field-label { font-size: 11px; color: #888; margin-bottom: 4px; line-height: 1.2; }

        .print-custom-select { position: relative; width: 100%; }
        .print-custom-select-trigger {
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 10px; height: 36px; background: #fff;
            border: 1px solid #d9d9d9; border-radius: 6px; cursor: pointer;
            font-size: 12px; color: #333; transition: all 0.2s ease; user-select: none; box-sizing: border-box;
        }
        .print-custom-select-trigger:hover { border-color: #1677ff; }
        .print-custom-select.open .print-custom-select-trigger { border-color: #1677ff; box-shadow: 0 0 0 2px rgba(22,119,255,0.15); }
        .print-custom-select-trigger > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }

        .print-custom-select-arrow {
            width: 7px; height: 7px; border-left: 2px solid #999; border-bottom: 2px solid #999;
            transform: rotate(-45deg); transition: transform 0.2s ease; flex-shrink: 0; margin-left: 6px;
        }
        .print-custom-select.open .print-custom-select-arrow { transform: rotate(135deg); }

        .print-custom-select-dropdown {
            position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: #fff;
            border: 1px solid #e8e8e8; border-radius: 6px; box-shadow: 0 6px 16px rgba(0,0,0,0.08);
            opacity: 0; visibility: hidden; pointer-events: none; z-index: 99999;
            transition: all 0.2s ease; max-height: 200px; overflow-y: auto; padding: 4px 0;
        }
        .print-custom-select.open .print-custom-select-dropdown { opacity: 1; visibility: visible; pointer-events: auto; }

        .print-custom-select-option {
            padding: 7px 10px; font-size: 12px; color: #333; cursor: pointer; transition: background 0.15s;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .print-custom-select-option:hover { background: #f5f5f5; }
        .print-custom-select-option.selected { background: #e6f4ff; color: #1677ff; font-weight: 500; }

        .print-preview-box {
            padding: 12px 14px; border: 1px solid #e8e8e8; border-radius: 6px;
            background: #f9f9f9; min-height: 40px; line-height: 1.6; font-size: 14px;
            color: #333; overflow: hidden;
        }

        .swal2-popup.print-dialog-popup { padding: 18px 22px 16px !important; }
        .swal2-popup.print-dialog-popup .swal2-title { font-size: 18px !important; margin: 0 0 12px !important; padding: 0 !important; }
        .swal2-popup.print-dialog-popup .swal2-html-container { margin: 0 !important; padding: 0 !important; font-size: inherit !important; }
        .swal2-popup.print-dialog-popup .swal2-actions { margin: 14px 0 0 !important; gap: 8px !important; }
        .swal2-popup.print-dialog-popup .swal2-confirm,
        .swal2-popup.print-dialog-popup .swal2-cancel { padding: 8px 22px !important; font-size: 13px !important; font-weight: 500 !important; border-radius: 6px !important; box-shadow: none !important; }

        /* ===== 5.4 响应式精简设置面板 ===== */
        .swal2-popup.print-dialog-popup {
            width: min(700px, calc(100vw - 24px)) !important;
            max-height: calc(100vh - 24px) !important;
            padding: 20px 22px 16px !important;
            border-radius: 8px !important;
        }
        .swal2-popup.print-dialog-popup .swal2-title {
            margin-bottom: 16px !important;
            text-align: left !important;
            color: #171717 !important;
            font-size: 19px !important;
        }
        .swal2-popup.print-dialog-popup .swal2-html-container { overflow: visible !important; }
        .print-dialog-container { padding: 0; }
        .print-dialog-section { margin: 0; padding: 12px 0; border-top: 1px solid #ededed; }
        .print-dialog-section:first-child { padding-top: 0; border-top: 0; }
        .print-dialog-label { margin-bottom: 7px; color: #262626; font-size: 12px; }
        .print-dialog-input,
        .print-custom-select-trigger { height: 34px; border-color: #d4d4d4; border-radius: 5px; }
        .print-option-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 2px;
            padding: 3px;
            border-radius: 6px;
            background: #f0f1f2;
        }
        .print-option-card {
            justify-content: center;
            min-height: 30px;
            padding: 3px 8px;
            border: 0;
            border-radius: 4px;
            background: transparent;
        }
        .print-option-card:hover { border: 0; background: #fff; }
        .print-option-card.active { border: 0; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
        .print-option-card input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; }
        .print-option-card span { color: #525252; font-size: 12px; }
        .print-option-card.active span { color: #1268d3; font-weight: 600; }
        .print-row-3 { gap: 10px; }
        .print-row-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        .print-field-label { margin-bottom: 5px; color: #737373; font-size: 11px; }
        .print-layout-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); height: 34px; box-sizing: border-box; }
        .print-preview-wrap { display: grid; grid-template-columns: 46px minmax(0, 1fr); align-items: center; gap: 10px; }
        .print-preview-caption { color: #737373; font-size: 11px; }
        .print-preview-box {
            min-height: 0;
            padding: 8px 10px;
            border: 0;
            border-left: 2px solid #1677ff;
            border-radius: 0;
            background: #f7f8fa;
            font-size: 13px;
            line-height: 1.5;
        }
        .swal2-popup.print-dialog-popup .swal2-actions { width: 100%; justify-content: flex-end; margin-top: 14px !important; }
        .swal2-popup.print-dialog-popup .swal2-confirm,
        .swal2-popup.print-dialog-popup .swal2-cancel { min-height: 34px; padding: 6px 18px !important; border-radius: 5px !important; }
        .swal2-popup.print-dialog-popup .swal2-cancel { background: #eef0f2 !important; color: #333 !important; }
        body.swal2-shown .zujuanjs-float-print-btn { display: none !important; }

        @media (max-width: 620px) {
            .swal2-popup.print-dialog-popup { padding: 16px 14px 12px !important; }
            .print-row-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .print-row-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .print-row-3 .print-field:first-child { grid-column: 1 / -1; }
        }
        @media (max-width: 390px) {
            .print-option-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .print-preview-wrap { grid-template-columns: 1fr; gap: 5px; }
            .print-dialog-section { padding-top: 9px; padding-bottom: 9px; }
        }

        /* 预览遮罩层 */
        #zujuanjs-preview-overlay {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 100000; background: #000;
            opacity: 0; transition: opacity .15s ease;
        }
        #zujuanjs-preview-overlay iframe { width: 100%; height: 100%; border: none; }
    `);

    class PaperPrinter {
        constructor() { this.init(); }

        init() {
            // 公式基准尺寸缓存已改为模块级（见文件顶部 _formulaBaseBySrc / _formulaBaseByIndex），跨重建持久。
            this.autoCheckIn();
            this.createFloatingButton();
            // [C] 自检模式：编辑器勾选「自检模式」或 URL 带 #selfcheck 时，延迟运行（等 SPA 渲染题目）
            const enableSelfCheck = GM_getValue('zujuanjsSelfCheck', false) === true
                || (location.hash || '').toLowerCase().indexOf('selfcheck') !== -1;
            if (enableSelfCheck) setTimeout(() => this.runSelfCheck(), 1500);
            if (document.body) this.startAdRemover();
            else document.addEventListener('DOMContentLoaded', () => this.startAdRemover());

            window.addEventListener('message', (e) => {
                // 安全加固：拒绝非本页来源且非沙箱(null)来源、或缺少/不匹配令牌的消息
                if (e.origin && e.origin !== window.location.origin && e.origin !== SANDBOX_NULL_ORIGIN) return;
                if (!e.data || typeof e.data !== 'object' || e.data.token !== PREVIEW_TOKEN) return;
                if (e.data.type === 'closeZujuanPreview') {
                    const overlay = document.getElementById('zujuanjs-preview-overlay');
                    if (overlay) overlay.remove();
                } else if (e.data && e.data.type === 'saveZujuanPreviewPreference') {
                    if (e.data.key === 'previewLayout' && ['single', 'double'].includes(e.data.value)) {
                        GM_setValue('previewLayout', e.data.value);
                    }
                    if (e.data.key === 'previewZoom' && (e.data.value === 'auto' || /^\d+(\.\d+)?$/.test(e.data.value))) {
                        GM_setValue('previewZoom', e.data.value);
                    }
                    if (e.data.key === 'editorPanelWidth' && /^\d+(\.\d+)?$/.test(e.data.value)) {
                        GM_setValue('editorPanelWidth', Math.max(280, Math.min(520, Number(e.data.value))));
                    }
                    if (e.data.key === 'editorPanelTab' && ['document', 'page'].includes(e.data.value)) {
                        GM_setValue('editorPanelTab', e.data.value);
                    }
                    if (e.data.key === 'editorOpen' && ['true', 'false'].includes(e.data.value)) {
                        GM_setValue('editorOpen', parseBool(e.data.value));
                    }
                    if (e.data.key === 'autoCheckIn' && ['true', 'false'].includes(e.data.value)) {
                        GM_setValue('zujuanjsAutoCheckIn', parseBool(e.data.value));
                    }
                    if (e.data.key === 'selfCheck' && ['true', 'false'].includes(e.data.value)) {
                        GM_setValue('zujuanjsSelfCheck', parseBool(e.data.value));
                    }
                } else if (e.data && e.data.type === 'saveZujuanPrintSettings') {
                    this.savePreviewSettings(e.data.settings);
                } else if (e.data && e.data.type === 'fetchSiteDetails') {
                    // 预览面板点「获取答案/考点」：抓取必须在父窗口执行（需要真实页面环境），
                    // 抓完通过 siteDetailsReady 通知 iframe 触发增量重建
                    this.fetchSiteDetailsForPreview();
                } else if (e.data && e.data.type === 'rebuildZujuanPreview') {
                    // 增量重建：仅把新生成的题目内容 HTML 发回 iframe，由 iframe 内部替换 sourceContent 并重渲染，
                    // 避免每次重建都重新设置 iframe.srcdoc 触发整页重载（表现为黑屏闪烁）。
                    const iframe = document.querySelector('#zujuanjs-preview-overlay iframe.zujuanjs-preview-frame');
                    if (iframe && iframe.contentWindow) {
                        try {
                            const settings = this.getPreviewSettings(e.data.settings || {});
                            const flags = settings.contentFlags || ['q'];
                            const includeQuestions = flags.includes('q');
                            const includeKnowledge = flags.includes('kp');
                            const includeAnswers = flags.includes('a');
                            const answersAtEnd = Boolean(settings.answersAtEnd);
                            // [需求4] 不自动点击答案开关；仅当用户已在页面手动展开答案时才提取（否则答案区为空）
                            // 例外：抓取型站点（菁优网）的答案来自单题页缓存，与当前页面是否展开无关
                            const answersExpanded = getSiteProfile().detailFetch ? true : this.answersExpandedOnPage();
                            const sourceHtml = this.generateSourceContentHTML({
                                includeQ: includeQuestions,
                                includeKP: includeKnowledge,
                                includeA: includeAnswers && answersExpanded,
                                atEnd: answersAtEnd && answersExpanded,
                                font: settings.font,
                                size: settings.size,
                                lineHeight: settings.lineHeight,
                                title: settings.title,
                                pageFont: settings.pageFont || settings.font,
                                pageSize: settings.pageSize || '12px',
                                pageBold: settings.pageBold,
                                layoutOptions: settings
                            });
                            iframe.contentWindow.postMessage({ type: 'updateZujuanSource', token: PREVIEW_TOKEN, html: sourceHtml.html }, '*');
                            // 增量更新也要落盘，否则关闭预览后重新打开会丢失本次勾选
                            this.savePreviewSettings(settings);
                        } catch (err) {
                            console.error('[组卷打印] 增量重建预览失败，回退整页重载：', err);
                            this.openPreviewWithSettings(e.data.settings);
                        }
                    } else {
                        this.openPreviewWithSettings(e.data.settings);
                    }
                } else if (e.data && e.data.type === 'zujuanPreviewRendered') {
                    // iframe 首屏渲染完成：淡入 overlay，避免 srcdoc 重载期间的黑屏闪烁
                    const overlay = document.getElementById('zujuanjs-preview-overlay');
                    if (overlay) overlay.style.opacity = '1';
                    // [E3.2] 兑现「就绪」承诺，放行等待中的答案增量注入
                    if (this._previewReadyResolve) { this._previewReadyResolve(); this._previewReadyResolve = null; }
                    this._previewReady = true;
                }
            });
        }

        getPaperTitle() {
            const profile = getSiteProfile();
            // 优先使用站点专属的选择器列表；未配置的站点沿用原有通用列表（组卷网行为不变）。
            // h1 放在最后：页面上常有 logo/导航等无关 h1，先匹配它会取到错误标题。
            const selectors = (profile.paperTitleSels && profile.paperTitleSels.length)
                ? profile.paperTitleSels
                : ['.paper-title', '.title-box', 'h1', '.exam-title', '.paper-name'];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (!el) continue;
                // 组卷中心的卷名放在 <input id="exam-maintitle"> 的 value 中，
                // input 没有文本内容，用 textContent 会取到容器内的副标题等无关文字。
                if (el.matches('input, textarea')) {
                    const value = String(el.value || el.getAttribute('value') || '').trim();
                    if (value) return value.replace(/\s+/g, ' ');
                    continue;
                }
                const text = el.textContent.trim();
                if (text) return text.replace(/\s+/g, ' ');
            }
            return '试卷';
        }

        autoCheckIn() {
            // [S4.2] 默认关闭：仅在用户显式开启自动签到时才执行，避免对账号产生未授权的副作用。
            // 开启方式：在控制台执行 GM_setValue('zujuanjsAutoCheckIn', true)，或在编辑器面板勾选「自动签到」。
            if (GM_getValue('zujuanjsAutoCheckIn', false) !== true) return;
            setTimeout(() => {
                const signedInLink = document.querySelector('.user-assets-box a.assets-method[href="/score_task/"]');
                if (signedInLink && signedInLink.textContent.trim() !== '已签到') {
                    document.querySelector('a.sign-in-btn')?.click();
                    document.querySelector('a.day-sign-in')?.click();
                }
            }, 2500);
        }

        runSelfCheck() {
            // [C] 自检模式：打开页面时自动校验脚本依赖的关键 DOM 与配置，结果打印到控制台。
            // 启用：编辑器面板勾选「自检模式」，或在 URL 后加 #selfcheck 强制本次运行。
            // 组卷中心通过点击题目本身展开答案，没有显式「显示答案」开关；
            // 试卷详情页才有显式开关（#isshowAnswer / .tklabel-checkbox.show-answer input）。
            // 据此判断显式答案开关自检项是否适用，避免组卷中心页面永远误报「缺失」。
            const profile = getSiteProfile();
            const answerSwitchSel = profile.answerSwitchSel || ANSWER_SWITCH_SEL;
            const pageHasExplicitAnswerSwitch = !!(profile.answerSwitchSel && document.querySelector(profile.answerSwitchSel));
            const titleSel = profile.sectionTitles.map(t => t.sel).join(', ');
            const domRules = [
                { name: `试题根 ${profile.questionRootSel}`, sel: profile.questionRootSel, required: true },
                { name: `小节标题 ${titleSel}`, sel: titleSel, required: false },
                { name: '答案开关', sel: answerSwitchSel, required: false, onlyIfExplicitSwitch: true, skipIfNoAnswers: true },
                // 跨页面通用·结构检查：自检在页面加载时运行，而组卷中心答案需手动点开、刷新即丢失，
                // 故「答案当前是否已渲染」属运行时状态，加载那一刻永远不成立，不适合做自检项（会永远失败、误导）。
                // 改为校验脚本提取答案所依赖的结构锚点 .exam-item__opt（答案区所在容器，静态 DOM 中即存在、未展开时为空），
                // 与运行时是否展开无关；真正「答案是否已显示」由打印时的 answersExpandedOnPage() 在用户点击后判定。
                { name: `答案提取锚点 ${profile.optionSel || '—'}`, sel: profile.optionSel || '.__no_answer_anchor__', required: false, skipIfNoAnswers: true },
                { name: '打印按钮 .zujuanjs-float-print-btn', sel: '.zujuanjs-float-print-btn', required: true },
                { name: '签到入口 .user-assets-box a[href="/score_task/"]', sel: '.user-assets-box a[href="/score_task/"]', required: false, siteOnly: 'xkw' },
            ];
            const domResults = domRules.map(r => {
                let hits = 0;
                try { hits = document.querySelectorAll(r.sel).length; } catch (e) { hits = -1; }
                // 显式答案开关仅适用于试卷详情页；组卷中心无此元素，标记为「不适用」而非「缺失」，避免误报
                if (r.onlyIfExplicitSwitch && !pageHasExplicitAnswerSwitch) {
                    return { 检查项: r.name, 选择器: r.sel, 命中: 0, 状态: '不适用' };
                }
                // 站点本身不提供答案/该结构时标记「不适用」，避免永远误报缺失
                if ((r.skipIfNoAnswers && !profile.hasAnswers) || (r.siteOnly && r.siteOnly !== profile.id)) {
                    return { 检查项: r.name, 选择器: r.sel, 命中: 0, 状态: '不适用' };
                }
                const ok = hits > 0;
                return { 检查项: r.name, 选择器: r.sel, 命中: hits, 状态: ok ? 'OK' : (r.required ? '缺失(必需)' : '缺失(可选)') };
            });

            // 公式检查按站点分流：图片化公式站点校验 isFormulaSvgImage；HTML+CSS 公式站点校验公式容器
            if (profile.formulaKind === 'svg-image') {
                let imgTotal = 0, formulaHits = 0;
                try {
                    const imgs = Array.from(document.querySelectorAll('img')).slice(0, 30);
                    imgTotal = imgs.length;
                    formulaHits = imgs.filter(img => this.isFormulaSvgImage(img)).length;
                } catch (e) {}
                domResults.push({
                    检查项: '公式识别 isFormulaSvgImage', 选择器: 'img(抽样≤30)', 命中: `${formulaHits}/${imgTotal}`,
                    状态: imgTotal === 0 ? '无样本' : (formulaHits > 0 || imgTotal < 30 ? 'OK' : '未识别')
                });
            } else {
                let mathjyeHits = 0;
                try { mathjyeHits = document.querySelectorAll('.MathJye, .mrow, .mfrac, .msqrt').length; } catch (e) {}
                domResults.push({
                    检查项: '公式容器（HTML+CSS 公式）', 选择器: '.MathJye / .mrow / .mfrac / .msqrt',
                    命中: mathjyeHits, 状态: mathjyeHits > 0 ? 'OK' : '无样本'
                });
            }

            // 代码/配置层自检（模块级常量在父窗口作用域内可直接访问）
            const codeRules = [
                { name: 'PREVIEW_TOKEN', ok: !!PREVIEW_TOKEN },
                { name: 'A4 常量', ok: (typeof A4 === 'object' && A4.w === 210 && A4.h === 297) },
                { name: 'LAYOUT_PRESETS.compact', ok: !!(typeof LAYOUT_PRESETS === 'object' && LAYOUT_PRESETS.compact) },
                { name: 'FONT_OPTIONS', ok: Array.isArray(FONT_OPTIONS) && FONT_OPTIONS.length > 0 },
                { name: 'PREVIEW_SETTING_SCHEMA', ok: Array.isArray(PREVIEW_SETTING_SCHEMA) && PREVIEW_SETTING_SCHEMA.length > 0 },
                { name: 'getPreviewSettings()', ok: (() => { try { return !!this.getPreviewSettings({}); } catch (e) { return false; } })() },
            ];
            const codeResults = codeRules.map(r => ({ 检查项: r.name, 选择器: '—', 命中: r.ok ? 1 : 0, 状态: r.ok ? 'OK' : '异常' }));

            const all = domResults.concat(codeResults);
            // 仅「必需依赖缺失」与「配置异常」算未通过；可选依赖缺失属正常现象，单独提示不计入失败。
            const failed = all.filter(x => x.状态 === '缺失(必需)' || x.状态 === '异常');
            const optionalMissing = all.filter(x => x.状态 === '缺失(可选)');
            const notApplicable = all.filter(x => x.状态 === '不适用');

            console.log('%c[组卷自检] 关键 DOM / 配置校验', 'color:#1677ff;font-weight:bold');
            try { console.table(all); } catch (e) { all.forEach(r => console.log(`  - ${r.检查项}: ${r.状态} (${r.命中})`)); }
            if (failed.length) {
                console.warn('%c[组卷自检] 未通过 ' + failed.length + ' 项（必需依赖缺失）：' + failed.map(x => x.检查项).join('、'), 'color:#fa8c16');
            } else {
                console.log('%c[组卷自检] 全部通过 ✅', 'color:#52c41a;font-weight:bold');
            }
            if (notApplicable.length) {
                console.info('%c[组卷自检] 不适用 ' + notApplicable.length + ' 项（当前页面无此结构，非异常）：' + notApplicable.map(x => x.检查项).join('、'), 'color:#bfbfbf');
            }
            if (optionalMissing.length) {
                console.info('%c[组卷自检] 可选依赖未出现 ' + optionalMissing.length + ' 项（属正常，不影响功能）：' + optionalMissing.map(x => x.检查项).join('、'), 'color:#8c8c8c');
            }
            this._lastSelfCheck = { total: all.length, failed: failed.length, optionalMissing: optionalMissing.length, results: all };
            return this._lastSelfCheck;
        }

        createFloatingButton() {
            if (document.getElementById('zujuanjs-float-print-btn')) return;
            const btn = document.createElement('button');
            btn.id = 'zujuanjs-float-print-btn';
            btn.className = 'zujuanjs-float-print-btn';
            btn.setAttribute('aria-label', '打开试卷打印预览');
            btn.innerHTML = `
                <span class="zujuanjs-float-print-btn-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M5 1a2 2 0 0 0-2 2v2h2V3h6v2h2V3a2 2 0 0 0-2-2H5Z"/><path d="M4 10h8v5H4v-5Zm1 1v3h6v-3H5Z"/><path d="M2 5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1v-4h10v4h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H2Zm11 2.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z"/></svg>
                </span>
                <span class="zujuanjs-float-print-btn-text">打印试卷</span>`;
            btn.onclick = (e) => { e.preventDefault(); this.showPrintDialog(); };
            document.body.appendChild(btn);
        }

        // 供预览面板调用：抓取单题页并把进度/完成消息回传给 iframe
        async fetchSiteDetailsForPreview() {
            const profile = getSiteProfile();
            const iframe = document.querySelector('#zujuanjs-preview-overlay iframe.zujuanjs-preview-frame');
            const post = msg => {
                if (iframe && iframe.contentWindow) {
                    try { iframe.contentWindow.postMessage(Object.assign({ token: PREVIEW_TOKEN }, msg), '*'); }
                    catch (e) { /* 忽略 */ }
                }
            };
            if (!profile.detailFetch) {
                post({ type: 'siteDetailsReady', total: 0, failed: 0 });
                return;
            }
            try {
                const result = await this.fetchAllSiteDetails(profile, (done, total) => {
                    post({ type: 'siteDetailProgress', done, total });
                });
                post({ type: 'siteDetailsReady', total: result.total, failed: result.failed, cached: !!result.fromCache });
            } catch (err) {
                post({ type: 'siteDetailsReady', total: 0, failed: 0, error: true });
            }
        }

        startAdRemover() {
            let pending = null;
            const observer = new MutationObserver(() => {
                // 防抖：合并短时间内多次 DOM 变动，避免高频重复查询
                if (pending) return;
                pending = setTimeout(() => {
                    pending = null;
                    let removed = false;
                    Config.adSelectors.forEach(sel => {
                        const el = document.querySelector(sel);
                        if (el) { el.remove(); removed = true; }
                    });
                    // 广告元素删完即停止监听，不再常驻轮询整个 body
                    if (removed && !Config.adSelectors.some(sel => document.querySelector(sel))) {
                        observer.disconnect();
                    }
                }, 300);
            });
            observer.observe(document.body, { childList: true, subtree: true });
            // 兜底：3 秒后无论是否清理干净都断开，防止极端情况下监听常驻
            setTimeout(() => observer.disconnect(), SAFETY_TIMEOUT_MS);
        }

        initSelect(id, onChange) {
            const select = document.getElementById(id);
            if (!select) return;
            const trigger = select.querySelector('.print-custom-select-trigger');
            const options = select.querySelectorAll('.print-custom-select-option');

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.print-custom-select.open').forEach(s => { if (s !== select) s.classList.remove('open'); });
                select.classList.toggle('open');
            });

            options.forEach(opt => {
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const value = opt.dataset.value;
                    options.forEach(o => o.classList.remove('selected'));
                    opt.classList.add('selected');
                    select.dataset.value = value;
                    trigger.querySelector('span').textContent = opt.textContent;
                    select.classList.remove('open');
                    if (onChange) onChange(value);
                });
            });
        }

        getPreviewSettings(overrides = {}) {
            // [已移除] 旧版「exam→compact」一次性迁移：PREVIEW_SETTING_SCHEMA 中 layoutPreset 的 def 已是 'compact'，
            // 新用户由 schema 默认建立，老用户早已迁移完成，无需保留此历史补丁。
            const has = key => Object.prototype.hasOwnProperty.call(overrides, key);
            const result = {};
            for (const s of PREVIEW_SETTING_SCHEMA) {
                // undefined 的覆盖值视为"未提供"，回退到存储值/默认值，避免误杀 schema 默认（如 size 变空导致公式缩放漂移）
                if (has(s.key) && overrides[s.key] !== undefined) {
                    result[s.key] = overrides[s.key];
                } else if (s.type === 'title') {
                    result[s.key] = this.getPaperTitle();
                } else {
                    const stored = s.storage != null ? GM_getValue(s.storage, s.def) : s.def;
                    result[s.key] = coerceSetting(s.type, stored, s.def);
                }
            }
            // pageFont 缺省回退到 font
            if (result.pageFont == null) result.pageFont = result.font;
            // 非 schema 管理的复杂对象
            result.documentEdits = has('documentEdits') && overrides.documentEdits && typeof overrides.documentEdits === 'object'
                ? overrides.documentEdits
                : {};
            result.readingAnchor = has('readingAnchor') && overrides.readingAnchor && typeof overrides.readingAnchor === 'object'
                ? overrides.readingAnchor
                : null;
            // 保证 layoutPreset 始终是已知预设键或 'custom'：脏值/空串（旧迁移残留、误写）一律回退到默认 'compact'，
            // 避免首屏出现「实际是紧凑版式、UI 却显示自定义」的状态不一致。'custom' 为手动微调后的有效状态。
            if (!LAYOUT_PRESETS[result.layoutPreset] && result.layoutPreset !== 'custom') result.layoutPreset = 'compact';
            return result;
        }

        savePreviewSettings(settings = {}) {
            for (const s of PREVIEW_SETTING_SCHEMA) {
                if (!Object.prototype.hasOwnProperty.call(settings, s.key)) continue;
                if (s.storage == null) continue; // title 等无存储项
                const val = settings[s.key];
                switch (s.type) {
                    case 'csv': GM_setValue(s.storage, Array.isArray(val) ? val.join(',') : val); break;
                    case 'boolStr': GM_setValue(s.storage, val ? 'true' : 'false'); break;
                    case 'boolObj': GM_setValue(s.storage, Boolean(val)); break;
                    default:
                        if (s.key === 'baseAnswerLinesByType' && val && typeof val === 'object') {
                            GM_setValue(s.storage, JSON.stringify(val));
                        } else {
                            GM_setValue(s.storage, val);
                        }
                }
            }
        }

        async openPreviewWithSettings(overrides = {}) {
            try {
                // 重新打开新卷时清空公式基准缓存，避免不同试卷间共享公式 src 导致基准串味
                resetFormulaBaseCache();
                // 预取站点公式样式（菁优网等 HTML+CSS 公式引擎）；失败不阻塞预览生成
                try { await this.prefetchSiteAssets(); } catch (e) { /* 忽略，走兜底样式 */ }
                // [P1.1] 已处理片段缓存改为全局持久（模块级 _fragmentCache），不按新卷清空，
                // 跨试卷复用同一内容签名片段；内存由 FRAGMENT_CACHE_CAP 上限约束。
                const settings = this.getPreviewSettings(overrides);
                this.savePreviewSettings(settings);
                const flags = settings.contentFlags || ['q'];
                const includeQuestions = flags.includes('q');
                const includeKnowledge = flags.includes('kp');
                const includeAnswers = flags.includes('a');
                const answersAtEnd = Boolean(settings.answersAtEnd);
                const siteProfileForPreview = getSiteProfile();
                const siteHasAnswers = siteProfileForPreview.hasAnswers;
                // 答案需从单题页抓取的站点（菁优网）不走「请先在页面展开答案」的等待与提示分支
                const needAnswers = (includeAnswers || answersAtEnd) && siteHasAnswers && !siteProfileForPreview.detailFetch;

                // [E3.1] 空试卷保护：当前页面未识别到任何题目时提示，避免静默生成空白预览
                if (!document.querySelector(getSiteProfile().sourceNodesSel)) {
                    const msg = '当前页面未识别到题目，无法生成预览。请确认已打开一份试卷（组卷网或菁优网）。';
                    if (typeof GM_notification === 'function') GM_notification({ text: msg, title: '组卷打印助手' });
                    else alert(msg);
                    return;
                }

                // 抓取型站点（菁优网）的答案来自缓存，首次生成即可带上，无需等待异步注入
                const cacheBackedAnswers = !!getSiteProfile().detailFetch;
                const baseOpts = {
                    includeQ: includeQuestions, includeKP: includeKnowledge,
                    includeA: includeAnswers && cacheBackedAnswers,
                    atEnd: answersAtEnd && cacheBackedAnswers,
                    font: settings.font, size: settings.size, lineHeight: settings.lineHeight, title: settings.title,
                    pageFont: settings.pageFont || settings.font, pageSize: settings.pageSize || '12px', pageBold: settings.pageBold,
                    layoutOptions: settings
                };

                // 复用已打开的预览：不走 openPreview 重设 iframe.srcdoc（避免每次点击黑屏闪烁），
                // 改为增量更新 sourceContent。仅当 overlay 不存在（首次打开）才整页注入 srcdoc。
                // [E3.2] 首开时建立「就绪」承诺：iframe 首屏渲染完成（收到 zujuanPreviewRendered）后兑现，
                // 答案注入前 await 它，避免 iframe 消息监听尚未注册导致增量消息丢失。
                const existingOverlay = document.getElementById('zujuanjs-preview-overlay');
                const existingIframe = existingOverlay && existingOverlay.querySelector('iframe.zujuanjs-preview-frame');
                let previewReady;
                if (existingIframe && existingIframe.contentWindow) {
                    previewReady = Promise.resolve();
                    const srcObj = this.generateSourceContentHTML(baseOpts);
                    existingIframe.contentWindow.postMessage({ type: 'updateZujuanSource', token: PREVIEW_TOKEN, html: srcObj.html }, '*');
                } else {
                    this._previewReadyResolve = null;
                    previewReady = new Promise(res => { this._previewReadyResolve = res; });
                    // 兜底：最多等 3s，超时也继续注入，避免极端情况下永久卡住
                    setTimeout(() => { if (this._previewReadyResolve) { this._previewReadyResolve(); this._previewReadyResolve = null; } }, SAFETY_TIMEOUT_MS);
                    this.openPreview(this.generatePreviewHTML(baseOpts));
                }

                // 异步：若需要答案，先确认答案是否已在页面手动展开。
                // [需求4] 不代点答案开关（避免消耗每日查看答案配额）：
                //   - 已展开：等待答案图加载完成后注入；
                //   - 未展开：提示用户先在组卷网点开「显示答案」，不注入空答案。
                if (needAnswers) {
                    if (!this.answersExpandedOnPage()) {
                        if (typeof GM_notification === 'function') {
                            GM_notification({ text: '预览未包含答案：请先在组卷网页面点开「显示答案」，再重新打开预览即可包含答案。', title: '组卷打印助手' });
                        }
                    } else {
                        const answerImgCount = await this.waitForImages();
                        // [E3.4] 原站无答案图时给出提示，避免静默缺答案
                        if (answerImgCount === 0 && typeof GM_notification === 'function') {
                            GM_notification({ text: '未在页面找到答案图片，可能需先在组卷网点开「显示答案」再预览。', title: '组卷打印助手' });
                        }
                        // [E3.2] 等 iframe 就绪（监听已注册）再发增量消息，否则消息会丢失
                        if (previewReady) {
                            try { await Promise.race([previewReady, new Promise(r => setTimeout(r, SAFETY_TIMEOUT_MS))]); } catch (e) { /* 忽略 */ }
                        }
                        try {
                            const answerHtml = this.generateSourceContentHTML(Object.assign({}, baseOpts, { includeA: includeAnswers, atEnd: answersAtEnd }));
                            const iframe = document.querySelector('#zujuanjs-preview-overlay iframe.zujuanjs-preview-frame');
                            if (iframe && iframe.contentWindow) {
                                iframe.contentWindow.postMessage({ type: 'updateZujuanSource', token: PREVIEW_TOKEN, html: answerHtml.html }, '*');
                            }
                        } catch (rebuildErr) {
                            console.warn('[组卷打印] 答案增量注入失败（面板已显示，仅缺答案）:', rebuildErr);
                        }
                    }
                }
            } catch (err) {
                console.error('[组卷打印] 生成预览失败：', err);
                const msg = '生成试卷预览失败：' + (err && err.message ? err.message : err);
                if (typeof GM_notification === 'function') GM_notification({ text: msg, title: '组卷打印助手' });
                else alert(msg);
            }
        }

        showPrintDialog() {
            this.openPreviewWithSettings();
        }

        // [需求4] 不再自动点击答案开关：是否包含答案完全取决于用户在组卷网页面是否已手动展开答案。
        // 自动点击会消耗站点每日查看答案配额，故脚本只做「检测」，绝不代点。
        answersExpandedOnPage() {
            const profile = getSiteProfile();
            // 站点不提供答案（如菁优网组卷中心/详情页均无答案 DOM）时恒为 false，避免误触发等待答案
            if (!profile.hasAnswers) return false;
            if (profile.answerSwitchSel) {
                const cb = document.querySelector(profile.answerSwitchSel);
                if (cb) return cb.checked === true;
            }
            // 无显式答案开关时，退而判断答案区块是否已渲染实质内容（图片/矢量）
            const opt = profile.optionSel || '.exam-item__opt';
            const ans = profile.answerSel || '.item.answer';
            return !!document.querySelector(`${opt} ${ans} img, ${opt} ${ans} svg`);
        }

        // 答案/解析提取后按题目缓存，后续重建预览直接复用，不再触碰原页面
        _getAnswerCache() {
            if (!this._answerCache) this._answerCache = new Map();
            return this._answerCache;
        }
        _cacheAnswerClone(wrap, clone) {
            if (wrap && clone) this._getAnswerCache().set(wrap, clone);
        }
        _getCachedAnswerClone(wrap) {
            return (wrap && this._getAnswerCache().has(wrap)) ? this._getAnswerCache().get(wrap) : null;
        }

        // [P1.1] 已处理片段按内容签名缓存：核心提取/重建路径（generateSourceContentHTML 题目大分支）。
        // 目的：复用已处理片段，避免预览重渲染（缩放/边距/页码等不改题目体的操作）每次都重做 DOM 克隆与
        // 题号剥离/知识点提取/答案解析分支。安全性：
        //  - 签名覆盖所有影响片段输出的输入（题型开关、字体字号行距、源 .wrapper.quesdiv 内容），任一变化即 miss 重处理；
        //  - 公式尺寸冻结（preparePreviewTypography，依赖模块级 _formulaBaseBySrc / _formulaBaseByIndex）完整保留，未改动；
        //  - 答案缓存（_answerCache，键为实时 wrap 引用）逻辑完整保留，未改动；
        //  - 仅在答案处于稳定就绪态（内联含答案）或内容非空（附末尾答案块）时才缓存含答案片段，避免缓存空壳。
        // 注意：缓存值为游离 DOM 节点引用（由 Map 强引用保值），复用时一律 cloneNode(true)，绝不把缓存节点本身插入结果树。
        _getFragmentCache() {
            // [P1.1] 全局缓存：直接返回模块级 _fragmentCache，跨试卷/会话复用，不再按实例或新卷清空。
            return _fragmentCache;
        }
        _hashString(str) {
            // djb2：将任意字符串压成短签名，作为缓存键，避免把大段 outerHTML 直接当键。
            let h = 5381;
            for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
            return (h >>> 0).toString(36);
        }
        _fragmentSignature(wrap, opts) {
            const { includeQ, includeKP, includeA, atEnd, font, size, lineHeight, answerSig } = opts;
            const content = wrap ? wrap.outerHTML : '';
            // answerSig 用于抓取型站点（菁优网）：其答案/考点来自单题页缓存、不在 wrap.outerHTML 内，
            // 若不纳入签名，「先无答案、后抓到答案」的重建会因签名相同而命中旧片段，导致答案不出现。
            return 'f' + this._hashString(
                `${includeQ ? 1 : 0}|${includeKP ? 1 : 0}|${includeA ? 1 : 0}|${atEnd ? 1 : 0}|${font}|${size}|${lineHeight}|${answerSig || ''}|${content}`
            );
        }
        _cacheFragment(sig, pair) {
            if (!sig || !pair) return;
            const cache = _fragmentCache;
            // 内存有界：达到上限且为新签名时，淘汰最早插入的项（Map 保持插入顺序，首项即最旧）。
            if (cache.size >= FRAGMENT_CACHE_CAP && !cache.has(sig)) {
                const oldest = cache.keys().next().value;
                if (oldest !== undefined) cache.delete(oldest);
            }
            cache.set(sig, pair);
        }
        _getCachedFragment(sig) {
            return (sig && this._getFragmentCache().has(sig)) ? this._getFragmentCache().get(sig) : null;
        }

        waitForImages(timeout = 4000) {
            // 仅等待答案图片（异步注入）出现即可：一旦出现，克隆到预览 HTML 由 iframe 承载，
            // iframe 内图片 onload 会自动重渲染分页，无需在此等待全部加载完成（避免首屏卡好几秒）。
            return new Promise(resolve => {
                const start = Date.now();
                const appearTimeout = 2500;
                const finish = (count) => { resolve(count || 0); };
                const tryWaitAppear = () => {
                    const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.src.includes('getAnswerAndParse'));
                    if (imgs.length === 0) {
                        if (Date.now() - start < appearTimeout) return setTimeout(tryWaitAppear, 150);
                        return finish(0);
                    }
                    return finish(imgs.length);
                };
                tryWaitAppear();
            });
        }

        removeLeadingNumber(container, profile) {
            // 题号位置规则（按页面类型）：先执行「元素删除」类规则，再执行「文本节点剥离」类规则（命中首个即停）。
            // 组卷中心等页面把题号放在独立 .quesindex 元素里（如 <span class="quesindex">1．</span>）；
            // 其余页面（试卷/章节/知识点）题号是文本节点开头的 "1." / "1 ." / 全角 "1．"，直接剥离。
            // 站点若在 profile 里声明了 numberStripSel（如菁优网 span.qseq），只按元素删除，不做文本剥离，
            // 避免误伤题干正文开头的数字。
            const LEADING_NUMBER_RULES = [
                { type: 'element', sel: '.quesindex' },
                { type: 'text', pattern: /^\s*\d+\s*[.\uFF0E]\s*/ },
            ];
            const rules = (profile && profile.numberStripSel)
                ? [{ type: 'element', sel: profile.numberStripSel }]
                : LEADING_NUMBER_RULES;
            for (const rule of rules) {
                if (rule.type === 'element') {
                    container.querySelectorAll(rule.sel).forEach(el => el.remove());
                } else if (rule.type === 'text') {
                    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
                    let node;
                    while (node = walker.nextNode()) {
                        if (node.textContent.match(rule.pattern)) {
                            node.textContent = node.textContent.replace(rule.pattern, '');
                            break;
                        }
                    }
                }
            }
        }

        extractKnowledgePoints(wrap, font, size) {
            // 从 .exam-item__opt > .item.knowlegde > .knowledge-box 中提取知识点
            const opt = wrap.querySelector('.exam-item__opt');
            if (!opt) return null;
            const kpItem = opt.querySelector('.item.knowlegde');
            if (!kpItem) return null;
            const kpBox = kpItem.querySelector('.knowledge-box');
            if (!kpBox) return null;

            const clone = kpBox.cloneNode(true);
            // 移除"解读"按钮等交互元素
            clone.querySelectorAll('.knowledge-explain, .btn_KnowledgeUnscramble').forEach(el => el.remove());

            // 提取知识点名称文本
            const names = Array.from(clone.querySelectorAll('.knowledge-name'))
                .map(el => el.textContent.trim())
                .filter(Boolean);
            if (names.length === 0) return null;

            const container = document.createElement('div');
            container.className = 'zujuanjs-knowledge-points';
            container.style.fontFamily = font;
            container.style.fontSize = size;
            container.style.marginTop = '6px';
            // 用 DOM 节点拼接而非 innerHTML，杜绝来自页面 DOM 的 HTML 注入面
            const titleSpan = document.createElement('span');
            titleSpan.style.color = '#1677ff';
            titleSpan.style.fontWeight = '600';
            titleSpan.textContent = '【知识点】';
            container.appendChild(titleSpan);
            container.appendChild(document.createTextNode(' ' + names.join('、')));
            return container;
        }

        isFormulaSvgImage(image) {
            const source = String(image.getAttribute('src') || '').toLowerCase();
            const hint = `${image.className || ''} ${image.getAttribute('alt') || ''}`.toLowerCase();
            return /(?:\.svg(?:[?#]|$)|^data:image\/svg\+xml)/.test(source)
                || /(?:math|formula|latex|katex|mathjax)/.test(hint);
        }

        // ── 菁优网单题页抓取（答案 / 考点） ─────────────────────────────────
        // 收集当前页面所有题目的单题页 URL（一题一个）
        collectSiteDetailUrls(profile) {
            const urls = [];
            document.querySelectorAll(profile.sourceNodesSel).forEach(node => {
                if (profile.excludeClosestSel && node.closest(profile.excludeClosestSel)) return;
                const wrap = node.querySelector(profile.contentRootSel);
                if (!wrap) return;
                const url = this.detailUrlOf(node, profile);
                if (url) urls.push(url);
            });
            const unique = Array.from(new Set(urls));
            if (!unique.length) {
                console.warn('[菁优网抓取] 未找到单题页链接。请确认：① 题目已加载完成；② 题目内存在「查看解析 / 解析」链接。');
            }
            return unique;
        }

        // 题目根元素：.fieldtip（含「查看解析 / 解析」链接）是 fieldset 的兄弟节点，不在其中，
        // 故查找单题页链接必须从题目根开始，而不是从内容源 fieldset 开始。
        detailRootOf(wrap) {
            if (!wrap) return null;
            return wrap.closest('.QUES_LI') || wrap.parentElement || wrap;
        }

        detailUrlOf(wrap, profile) {
            if (!wrap || !profile.detailLinkSel) return null;
            const root = this.detailRootOf(wrap);
            if (!root) return null;
            const link = root.querySelector(profile.detailLinkSel);
            return link && link.href ? link.href : null;
        }

        // 从已渲染的单题页文档提取答案与考点（图片/链接地址先绝对化，保证插入预览后可用）
        extractDetailFromDoc(doc, profile) {
            try {
                const root = doc.querySelector('fieldset.quesborder')
                    || doc.querySelector('.detail-item')
                    || doc.body;
                if (!root) return null;
                root.querySelectorAll('img').forEach(img => { if (img.src) img.setAttribute('src', img.src); });
                root.querySelectorAll('a').forEach(link => { if (link.href) link.setAttribute('href', link.href); });
                const answerEls = (profile.detailAnswerSels || [])
                    .map(sel => root.querySelector(sel)).filter(Boolean);
                const kpEl = profile.detailKnowledgeSel ? root.querySelector(profile.detailKnowledgeSel) : null;
                // 答案/考点块只作文字展示：去掉链接的 href/onclick（避免预览里可点跳转），
                // 并移除站点插在其中的 VIP 图标
                answerEls.concat(kpEl ? [kpEl] : []).forEach(blockEl => {
                    blockEl.querySelectorAll('a').forEach(link => {
                        link.removeAttribute('href');
                        link.removeAttribute('onclick');
                        link.removeAttribute('target');
                    });
                    blockEl.querySelectorAll('img[src*="icon-vip"]').forEach(img => img.remove());

                    // 注：曾尝试把「运算符 + 紧随公式」包进 span 以解决分页时「= 与公式分家」，
                    // 但实测无论用 inline-block 还是 inline，包裹都会干扰 MathJye 的渲染
                    //（.mfrac 的 vertical-align: calc(-50% + 0.255em) 依赖行盒上下文），
                    // 导致分数错位。故撤销该分组，保证公式渲染正确优先。
                });
                if (!answerEls.length && !kpEl) {
                    console.warn('[菁优网抓取] 页面已加载但未找到答案/考点节点',
                        'answerSels=' + JSON.stringify(profile.detailAnswerSels),
                        'kpSel=' + profile.detailKnowledgeSel,
                        'root=' + root.className);
                    return null;
                }
                const answerHtml = answerEls.map(el => el.outerHTML).join('');
                return {
                    answerHtml,
                    kpHtml: kpEl ? kpEl.outerHTML : '',
                };
            } catch (e) { return null; }
        }

        // 隐藏 iframe 加载单题页，等渲染完成（答案区块与 MathJye 标记均就绪）后提取
        loadDetailViaIframe(url) {
            return new Promise(resolve => {
                const profile = getSiteProfile();
                const frame = document.createElement('iframe');
                frame.setAttribute('aria-hidden', 'true');
                frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;height:800px;border:0;visibility:hidden;';
                const startedAt = Date.now();
                let settled = false;
                let timer = null;
                const finish = (value, reason) => {
                    if (settled) return;
                    settled = true;
                    if (timer) clearTimeout(timer);
                    try { frame.remove(); } catch (e) { /* 忽略 */ }
                    const cost = Date.now() - startedAt;
                    if (!value) {
                        console.warn('[菁优网抓取] 失败 ' + cost + 'ms（' + (reason || '未知原因') + '）  ' + url);
                    }
                    resolve(value);
                };
                timer = setTimeout(() => finish(null, '整体超时 10s'), 10000);
                frame.addEventListener('load', () => {
                    let tries = 0;
                    const poll = () => {
                        if (settled) return;
                        try {
                            const doc = frame.contentDocument;
                            if (doc) {
                                const hasAnswer = doc.querySelector('.pt11, .pt6, .pt5');
                                // 公式是否已渲染完毕：要求「所有 MathJye 都生成了 .mrow」。
                                // 只判断「存在任意一个 .mrow」不够 —— 可能只渲染了部分公式就放行，
                                // 未渲染的公式在预览里会显示成横排（如分数变成 a/b）。
                                // .mrow 是 MathJye 引擎的渲染产物，比站点的 ismathjyeloaded 标记可靠。
                                const mathEls = doc.querySelectorAll('.MathJye');
                                let pendingMath = 0;
                                mathEls.forEach(el => {
                                    if (!el.querySelector('.mrow')) { pendingMath++; return; }
                                    // 第二阶段校验：MathJye 先建 .mrow 结构、后写像素内联样式（.mo 的 padding-top/height 等）。
                                    // 只查 .mrow 会在样式写完前放行，抓到的公式缺少尺寸样式，预览里分数会又小又挤。
                                    const probe = el.querySelector('.mo, .fracLine');
                                    if (probe && !el.querySelector('.mo[style], .fracLine[style]')) pendingMath++;
                                });
                                const rendered = mathEls.length === 0 || pendingMath === 0;
                                if (hasAnswer && rendered) {
                                    return finish(this.extractDetailFromDoc(doc, profile), '');
                                }
                                // 保底：极慢页面等待约 8 秒仍无渲染标志也接受，避免整题取不到答案
                                //（此时会在日志中提示公式可能不完整）。
                                if (hasAnswer && tries > 32) {
                                    console.warn('[菁优网抓取] 公式渲染标志迟迟未出现，按当前内容提取（公式可能不完整，下次获取将重抓）');
                                    const partialResult = this.extractDetailFromDoc(doc, profile);
                                    if (partialResult && pendingMath > 0) partialResult.partial = true;
                                    return finish(partialResult, '');
                                }
                            }
                        } catch (e) { return finish(null, '读取 iframe 文档失败：' + (e && e.message)); }
                        if (++tries > 40) return finish(null, '渲染等待超时（10s 内未就绪）');
                        setTimeout(poll, 250);
                    };
                    setTimeout(poll, 300);
                });
                frame.addEventListener('error', () => finish(null, 'iframe 加载错误'));
                frame.src = url;
                document.body.appendChild(frame);
            });
        }

        // 批量抓取（并发 3，带进度回调）；已缓存跳过，失败记 null
        async fetchAllSiteDetails(profile, onProgress) {
            const urls = this.collectSiteDetailUrls(profile);
            // 待抓取 = 从未抓取过，或上次抓取失败（缓存值为 null）。
            // 这样再次点击按钮时，成功的题目会被跳过，只重试失败的题目。
            const pending = urls.filter(url => { const cached = _siteDetailGet(url); return !cached || cached.partial; });
            // 全部已缓存（无待抓取、无 partial 待重抓）→ 直接走缓存，不显示获取进度。
            // 只有存在失败/未抓取/partial 时才进入抓取流程。
            if (urls.length > 0 && pending.length === 0) {
                return { total: urls.length, failed: 0, fromCache: true };
            }
            let done = urls.length - pending.length;
            if (onProgress) onProgress(done, urls.length);
            const queue = pending.slice();
            // 并发降为 2：多个 iframe 同时加载容易互相争抢资源、导致站点响应变慢而超时
            const CONCURRENCY = 2;
            const worker = async () => {
                while (queue.length) {
                    const url = queue.shift();
                    let result = await this.loadDetailViaIframe(url);
                    if (!result) {
                        // 失败自动重试一次：超时多为偶发（资源争抢/网络抖动）
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        result = await this.loadDetailViaIframe(url);
                    }
                    _siteDetailCache.set(url, result ? Object.assign({}, result, { ver: SITE_DETAIL_CACHE_VER, partial: !!result.partial }) : null);
                    done++;
                    if (onProgress) onProgress(done, urls.length);
                }
            };
            const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) });
            await Promise.all(runners.map(() => worker()));
            const failed = urls.filter(url => !_siteDetailGet(url)).length;
            const okCount = urls.length - failed;
            console.log('[菁优网抓取] 结束：成功 ' + okCount + ' 题，失败 ' + failed + ' 题');
            if (failed) console.warn('[菁优网抓取] 有 ' + failed + ' 题失败（预览中这些题无答案与考点）；'
                + '再次点击按钮只会重试这些失败的题，已成功的不会重复抓取');
            return { total: urls.length, failed };
        }

        // 由缓存构造答案节点（包一层容器以复用现有「内联 / 附末尾」分支）
        buildSiteDetailAnswerNode(wrap, profile) {
            const url = this.detailUrlOf(wrap, profile);
            const detail = url ? _siteDetailGet(url) : null;
            if (!detail || !detail.answerHtml) {
                return null;
            }
            const box = document.createElement('div');
            box.className = 'zujuanjs-site-answer';
            box.innerHTML = detail.answerHtml;
            return box;
        }

        // 由缓存构造知识点（考点）节点
        buildSiteDetailKnowledge(wrap, profile, font, size) {
            const url = this.detailUrlOf(wrap, profile);
            const detail = url ? _siteDetailGet(url) : null;
            if (!detail || !detail.kpHtml) {
                return null;
            }
            const container = document.createElement('div');
            container.className = 'zujuanjs-knowledge-points';
            container.style.fontFamily = font;
            container.style.fontSize = size;
            container.style.marginTop = '6px';
            container.innerHTML = detail.kpHtml;
            return container;
        }

        // 预取站点公式样式并缓存（预览生成是同步的，故在此异步取好）。
            // 策略：只抓站点公式引擎样式表（href 含 mathjye）。
            // 注意不要抓 images/formula/style_www.css —— 它含 .quesborder 的字体族与 font-size:14px，
            // 会直接命中克隆来的 fieldset.quesborder，覆盖预览面板里的字号/字体设置。
        // 抓不到（无权限 / 无网络 / 站点改结构）则回退到内置样式包，保证公式仍能正确排版。
        async prefetchSiteAssets() {
            const profile = getSiteProfile();
            if (profile.formulaKind !== 'html-css') return;
            const key = siteCssCacheKey(profile);
            if (_siteCssCache.has(key)) return;

            let css = '';
            const hrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
                .map(link => link.href)
                .filter(href => /mathjye/i.test(href))
                .slice(0, 6);
            if (hrefs.length) {
                const texts = await Promise.all(hrefs.map(href => gmFetchText(href)));
                texts.forEach((text, index) => {
                    if (text) css += '\n' + absolutizeCssUrls(text, hrefs[index]);
                });
            }
            // 线上抓取不足时用内置包兜底
            if (css.trim().length < 500) css = profile.builtinFormulaCss || '';
            _siteCssCache.set(key, css.trim());
            try {
                window.__zujuanGetSiteCss = () => _siteCssCache.get(key) || '';
            } catch (e) { /* 忽略 */ }
        }

        preparePreviewTypography(root) {
            // 实时 DOM 中已布局的公式图（用于首渲冻结其真实尺寸）。只扫描题目容器，避免整页（含广告/头像）大数组分配，
            // 也更贴合 rootFormulas 的来源（题目体来自 .wrapper.quesdiv），降低下标错位风险。
            // 仅图片化公式的站点（组卷网）做尺寸冻结；菁优网公式为 HTML+CSS 排版（MathJye），无图片可冻结。
            if (getSiteProfile().formulaKind === 'svg-image') {
            const liveFormulas = Array.from(document.querySelectorAll(`${getSiteProfile().contentRootSel} img`)).filter(img => this.isFormulaSvgImage(img));
            const rootFormulas = Array.from(root.querySelectorAll('img')).filter(img => this.isFormulaSvgImage(img));
            rootFormulas.forEach((image, i) => {
                image.classList.add('zujuanjs-formula-svg');
                image.dataset.formulaBaseline = '14';
                const pixelStyle = value => /^\s*\d+(?:\.\d+)?px\s*$/.test(value || '') ? Number.parseFloat(value) : 0;
                const src = image.getAttribute('src') || '';
                let width = Number.parseFloat(image.getAttribute('width')) || pixelStyle(image.style.width);
                let height = Number.parseFloat(image.getAttribute('height')) || pixelStyle(image.style.height);
                // 优先复用已冻结的基准（按 src，其次按序号），保证跨次重建尺寸稳定，不被原站重排版带偏。
                const frozen = (src && _formulaBaseBySrc.get(src)) || _formulaBaseByIndex[i];
                if (frozen && (frozen.width > 0 || frozen.height > 0)) {
                    if (frozen.width > 0) width = frozen.width;
                    if (frozen.height > 0) height = frozen.height;
                } else {
                    // 未冻结过：本次捕获并冻结（优先用实时 naturalWidth，否则用显式 width/height）
                    if (width <= 0 && height <= 0) {
                        const live = liveFormulas[i];
                        if (live && live.naturalWidth > 0) {
                            width = live.naturalWidth;
                            if (live.naturalHeight > 0) height = live.naturalHeight;
                        }
                    }
                    if (width > 0 || height > 0) {
                        if (src) _formulaBaseBySrc.set(src, { width, height });
                        _formulaBaseByIndex[i] = { width, height };
                    }
                }
                if (Number.isFinite(width) && width > 0) image.dataset.formulaBaseWidth = String(width);
                if (Number.isFinite(height) && height > 0) image.dataset.formulaBaseHeight = String(height);
            });
            }

            const chinese = '[\\u3400-\\u9fff\\uf900-\\ufaff]';
            const roots = root.querySelectorAll('.zujuanjs-question-body, .zujuanjs-answer-item, .zujuanjs-section-title');
            roots.forEach(container => {
                const nodes = [];
                const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
                    acceptNode: node => {
                        const parent = node.parentElement;
                        if (!parent || !node.textContent || !/[A-Za-z]/.test(node.textContent) || !new RegExp(chinese).test(node.textContent)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return parent.closest('script, style, svg, math, mjx-container, .MathJax, .katex, .MathJye, code, pre, .zh-latin-gap')
                            ? NodeFilter.FILTER_REJECT
                            : NodeFilter.FILTER_ACCEPT;
                    }
                });
                let node;
                while (node = walker.nextNode()) nodes.push(node);

                nodes.forEach(textNode => {
                    const text = textNode.textContent;
                    const separated = text
                        .replace(new RegExp(`(${chinese})(?=[A-Za-z])`, 'g'), '$1\\u0000')
                        .replace(new RegExp(`([A-Za-z])(?=${chinese})`, 'g'), '$1\\u0000');
                    if (separated === text) return;
                    const fragment = document.createDocumentFragment();
                    separated.split('\\u0000').forEach((part, index, parts) => {
                        if (part) fragment.appendChild(document.createTextNode(part));
                        if (index < parts.length - 1) {
                            const gap = document.createElement('span');
                            gap.className = 'zh-latin-gap';
                            gap.setAttribute('aria-hidden', 'true');
                            fragment.appendChild(gap);
                        }
                    });
                    textNode.replaceWith(fragment);
                });
            });
        }

        generateSourceContentHTML(opts = {}) {
            const { includeQ, includeKP, includeA, atEnd, font, size, lineHeight, title, pageFont, pageSize, pageBold, layoutOptions = {} } = opts;
            const marginValues = String(layoutOptions.pageMargins || '18,15,22,15')
                .split(',')
                .map(value => Number(value));
            const validMargins = marginValues.length === 4 && marginValues.every(value => Number.isFinite(value) && value >= 8 && value <= 55);
            const [marginTop, marginRight, marginBottom, marginLeft] = validMargins ? marginValues : [18, 15, 22, 15];
            const contentWidth = A4.w - marginLeft - marginRight;
            const contentHeight = A4.h - marginTop - marginBottom;
            const footerBottom = Math.max(5, Math.min(9, marginBottom / 3));
            const questionSpacing = Math.max(0, Math.min(32, Number(layoutOptions.questionSpacing) || 10));
            const previewLayout = layoutOptions.previewLayout === 'single' ? 'single' : 'double';
            const rawPreviewZoom = String(layoutOptions.previewZoom || 'auto');
            const numericPreviewZoom = Number(rawPreviewZoom);
            const previewZoom = rawPreviewZoom === 'auto'
                ? 'auto'
                : String(Math.max(0.25, Math.min(2, Number.isFinite(numericPreviewZoom) ? numericPreviewZoom : 1)));
            const titleSize = Math.max(18, Math.min(36, parseFloat(layoutOptions.titleSize) || 24));
            const showPageNumber = layoutOptions.showPageNumber !== false;
            const paragraphSpacing = Math.max(0, Math.min(24, Number(layoutOptions.paragraphSpacing) || 8));
            const contentAlign = ['left', 'justify'].includes(layoutOptions.contentAlign) ? layoutOptions.contentAlign : 'left';
            const numberGap = Math.max(0.2, Math.min(2, Number(layoutOptions.numberGap) || 0.55));
            // 按题型分别设置默认答题行数：解析为 {objective,judge,fill,conceptFill,solution}，每类 0–8 行
            const baseAnswerLinesByType = (() => {
                const def = { objective: 0, judge: 0, fill: 0, conceptFill: 0, solution: 0 };
                let parsed = null;
                try {
                    parsed = typeof layoutOptions.baseAnswerLinesByType === 'string'
                        ? JSON.parse(layoutOptions.baseAnswerLinesByType)
                        : (layoutOptions.baseAnswerLinesByType && typeof layoutOptions.baseAnswerLinesByType === 'object' ? layoutOptions.baseAnswerLinesByType : null);
                } catch (e) { parsed = null; }
                if (parsed && typeof parsed === 'object') {
                    for (const k of Object.keys(def)) {
                        const v = Number(parsed[k]);
                        def[k] = Number.isFinite(v) ? Math.max(0, Math.min(24, Math.round(v))) : 0;
                    }
                }
                return def;
            })();
            const pageGap = Math.max(8, Math.min(48, Number(layoutOptions.pageGap) || 20));
            const editorPanelWidth = Math.max(280, Math.min(520, Number(layoutOptions.editorPanelWidth) || 340));
            const editorPanelTab = layoutOptions.editorPanelTab === 'page' ? 'page' : 'document';
            const editorOpen = layoutOptions.editorOpen !== false;
            const documentEdits = layoutOptions.documentEdits && typeof layoutOptions.documentEdits === 'object'
                ? layoutOptions.documentEdits
                : {};
            const readingAnchor = layoutOptions.readingAnchor && typeof layoutOptions.readingAnchor === 'object'
                ? layoutOptions.readingAnchor
                : null;
            const tempDiv = document.createElement('div');

            const titleEl = document.createElement('div');
            titleEl.className = 'zujuanjs-print-title';
            titleEl.dataset.documentTitle = 'true';
            titleEl.style.fontFamily = font;
            titleEl.style.fontSize = `${titleSize}px`;
            titleEl.style.display = title ? '' : 'none';
            titleEl.textContent = title;
            tempDiv.appendChild(titleEl);

            const answersEndList = [];
            let questionIndex = 1;

            // 章节标题提取：兼容旧版 `.sec-title` 与当前版 `.questype-head .questypetitle`（左题目标题区）。
            // 右侧「分组与排序」面板（.ques-type h3）是编辑视图，不属于打印内容，不取。
            const appendSection = (text) => {
                const section = document.createElement('div');
                section.className = 'zujuanjs-section-title';
                section.style.fontFamily = font;
                section.textContent = text;
                tempDiv.appendChild(section);
            };

            // 章节标题提取器与遍历选择器统一来自站点描述层（profile），新增站点只需改 profile，不动下方题目大分支。
            const profile = getSiteProfile();
            const SECTION_TITLE_EXTRACTORS = profile.sectionTitles;
            const sourceNodes = [...document.querySelectorAll(profile.sourceNodesSel)]
                .filter(node => !node.closest(profile.excludeClosestSel));
            sourceNodes.forEach(node => {
                for (const ex of SECTION_TITLE_EXTRACTORS) {
                    if (node.matches(ex.sel)) {
                        const t = ex.get(node);
                        if (t) appendSection(t);
                        return; // 命中标题提取器，不再走题目分支
                    }
                }

                const wrap = node.querySelector(profile.contentRootSel);
                if (!wrap) return;

                // [P1.1] 按内容签名复用已处理片段：签名覆盖题型开关/字体字号行距/源内容，任一变化即 miss 重处理。
                // 命中则克隆缓存片段（题目体 + 附末尾答案块）入树并跳过本次重处理；克隆保证缓存节点本身不被插入结果树。
                // 抓取型站点的答案/考点来自单题页缓存，需把缓存状态纳入签名：
                // 否则「首次生成时无答案 → 点获取答案后重建」会命中旧片段，答案不会出现
                //（表现为必须先重新勾选一次内容开关才会显示）。
                let answerSig = '';
                if (profile.detailFetch && (includeA || includeKP || atEnd)) {
                    const _sigUrl = this.detailUrlOf(wrap, profile);
                    const _sigDetail = _sigUrl ? _siteDetailCache.get(_sigUrl) : null;
                    answerSig = _sigDetail
                        ? ('a' + ((_sigDetail.answerHtml || '').length) + 'k' + ((_sigDetail.kpHtml || '').length))
                        : 'none';
                }
                const fragSig = this._fragmentSignature(wrap, { includeQ, includeKP, includeA, atEnd, font, size, lineHeight, answerSig });
                const cachedFrag = this._getCachedFragment(fragSig);
                if (cachedFrag) {
                    tempDiv.appendChild(cachedFrag.q.cloneNode(true));
                    if (cachedFrag.a) answersEndList.push(cachedFrag.a.cloneNode(true));
                    questionIndex++;
                    return;
                }

                const qWrapper = document.createElement('div');
                qWrapper.className = 'q-wrapper';
                qWrapper.dataset.blockId = `question-${questionIndex}`;
                qWrapper.dataset.blockLabel = `第 ${questionIndex} 题`;
                qWrapper.tabIndex = 0;
                qWrapper.setAttribute('aria-label', `第 ${questionIndex} 题`);

                const qDiv = document.createElement('div');
                qDiv.className = 'zujuanjs-question';
                qDiv.style.fontFamily = font;
                qDiv.style.fontSize = size;
                qDiv.style.lineHeight = lineHeight;
                let questionBody = null;
                // 考点暂存：默认与答案同组（挂答案块头部）；无答案块时退回题干之后。
                // 注意必须声明在每题循环体作用域——答案分支在 if (includeQ) 块外，放块内会 ReferenceError。
                let pendingKpBox = null;

                if (includeQ) {
                    // 题目体可能由一个或多个部分组成：组卷网只有题干（.exam-item__cnt）；
                    // 菁优网的选项（.pt2）与题干（.pt1）平级，需一并克隆进题目体。
                    const partSources = profile.useContentRootAsBody
                        ? [wrap]
                        : profile.bodyPartSels.map(sel => wrap.querySelector(sel)).filter(Boolean);
                    const partClones = partSources
                        .map(part => {
                            const partClone = part.cloneNode(true);
                            // 剔除原站工具栏等非打印内容（菁优网 .fieldtip）
                            profile.stripSels.forEach(sel => partClone.querySelectorAll(sel).forEach(el => el.remove()));
                            // 菁优网公式：MathJye 会把运行时测量出的像素宽度写进 .mfrac（如 width: 39px），
                            // 分数线又是 .fracLine{width:100%}，预览中字形宽度与原站有细微差异时分子就会溢出错位。
                            // 这里直接移除该固定宽度改由内容自适应；高度与 padding 保留（用于基线对齐）。
                            if (profile.formulaKind === 'html-css') {
                                partClone.querySelectorAll('.mfrac').forEach(frac => frac.style.removeProperty('width'));
                            }
                            this.removeLeadingNumber(partClone, profile);
                            return partClone;
                        });
                    if (partClones.length) {
                        const questionLayout = document.createElement('div');
                        questionLayout.className = 'zujuanjs-question-layout';
                        const numSpan = document.createElement('span');
                        numSpan.className = 'zujuanjs-question-number';
                        numSpan.textContent = `${questionIndex}.`;
                        questionBody = document.createElement('div');
                        questionBody.className = 'zujuanjs-question-body';
                        partClones.forEach(clone => questionBody.appendChild(clone));

                        // 知识点提取：考点默认与答案同组（挂答案块头部，与【答案】【分析】【解答】一起），
                        // 框选/删除题目块时不会带上考点；无答案块时退回题干之后（见下方兜底）。
                        if (includeKP) {
                            const kpBox = profile.detailFetch
                                ? this.buildSiteDetailKnowledge(wrap, profile, font, size)
                                : this.extractKnowledgePoints(wrap, font, size);
                            if (kpBox) pendingKpBox = kpBox;
                        }

                        questionLayout.appendChild(numSpan);
                        questionLayout.appendChild(questionBody);
                        qDiv.appendChild(questionLayout);
                    }
                } else if (includeKP) {
                    // 不选试题但选知识点时，仍需创建容器来放知识点
                    questionBody = document.createElement('div');
                    questionBody.className = 'zujuanjs-question-body';
                    const kpBox = profile.detailFetch
                        ? this.buildSiteDetailKnowledge(wrap, profile, font, size)
                        : this.extractKnowledgePoints(wrap, font, size);
                    if (kpBox) {
                        const numSpan = document.createElement('span');
                        numSpan.className = 'zujuanjs-question-number';
                        numSpan.textContent = `${questionIndex}.`;
                        questionBody.appendChild(kpBox);
                        const questionLayout = document.createElement('div');
                        questionLayout.className = 'zujuanjs-question-layout';
                        questionLayout.appendChild(numSpan);
                        questionLayout.appendChild(questionBody);
                        qDiv.appendChild(questionLayout);
                    }
                }

                // 答案来源按站点分流：菁优网从单题页抓取缓存构造；组卷网从当前页面 DOM 取
                let cachedOpt = null;
                let opt = null;
                if (profile.detailFetch) {
                    opt = this.buildSiteDetailAnswerNode(wrap, profile);
                } else if (profile.hasAnswers) {
                    cachedOpt = this._getCachedAnswerClone(wrap);
                    opt = cachedOpt || wrap.querySelector(profile.optionSel);
                }
                // [P1.1] 记录答案就绪态/附末尾答案块，供末尾按内容签名缓存判定（避免缓存空壳）。
                let ansReady = false;
                let builtAnsWrapper = null;
                let answerHasRealContent = false;
                let pendingInlineAnswer = null;
                if (opt) {
                    const optClone = opt.cloneNode(true);
                    // 仅在答案区已就绪时才缓存（避免缓存未展开时的空壳，否则用户后续手动展开答案、
                    // 重新打开预览时仍复用空壳，导致答案始终为空）。未就绪则每次重读实时 DOM。
                    if (!cachedOpt) {
                        const ansNode = optClone.querySelector(profile.answerSel);
                        ansReady = !!(ansNode && (ansNode.querySelector('img, svg, canvas, table')
                            || ansNode.textContent.replace(/\s/g, '').length > 2));
                        if (ansReady) this._cacheAnswerClone(wrap, optClone);
                    }
                    // 知识点已在上面单独提取，这里移除避免重复
                    optClone.querySelector('.knowledge-box')?.remove();
                    optClone.querySelector('.item.knowlegde')?.remove();

                    if (atEnd) {
                        // 答案附末尾：无论是否内联，都把答案块放到试卷末尾（新页开始）
                        const answerWrap = document.createElement('div');
                        answerWrap.className = 'zujuanjs-answer-item';
                        answerWrap.style.fontFamily = font;
                        answerWrap.style.fontSize = size;
                        answerWrap.style.lineHeight = lineHeight;

                        // 提取答案内容：优先 .item.answer，但必须验证其内有实质内容（图片或文字）
                        // 组卷网答案多为整图烘焙（img），.item.answer 若只是空壳则降级取整段
                        let extracted = false;
                        const ansPart = profile.answerSel ? optClone.querySelector(profile.answerSel) : null;
                        if (ansPart) {
                            const ansHasImg = ansPart.querySelector('img, svg, canvas, table');
                            const ansHasText = ansPart.textContent.replace(/\s/g, '').length > 2;
                            if (ansHasImg || ansHasText) {
                                answerWrap.appendChild(ansPart);
                                extracted = true;
                            }
                        }
                        if (!extracted) {
                            // 降级：取整段 optClone（已移除知识点），确保图片答案不丢失
                            answerWrap.appendChild(optClone);
                        }

                        // 答案为空（无实质文本或图片）则跳过，不保留空题号。
                        // 兜底：同时看原 opt 的内容，避免容器写入环节异常导致误判为空。
                        answerHasRealContent = !!(answerWrap.querySelector('img, svg, canvas, table')
                            || answerWrap.textContent.replace(/\s/g, '').length > 2
                            || (opt && (opt.textContent || '').replace(/\s/g, '').length > 2));
                        if (answerHasRealContent) {
                            const answerHeader = document.createElement('div');
                            answerHeader.className = 'zujuanjs-answer-title';
                            answerHeader.style.fontFamily = font;
                            answerHeader.textContent = `${questionIndex}. `;
                            answerWrap.insertBefore(answerHeader, answerWrap.firstChild);

                            const ansWrapper = document.createElement('div');
                            ansWrapper.className = 'q-wrapper zujuanjs-answer-entry';
                            ansWrapper.dataset.blockId = `answer-${questionIndex}`;
                            ansWrapper.dataset.blockLabel = `第 ${questionIndex} 题答案`;
                            ansWrapper.tabIndex = 0;
                            ansWrapper.setAttribute('aria-label', `第 ${questionIndex} 题答案`);
                            ansWrapper.appendChild(answerWrap);
                            answersEndList.push(ansWrapper);
                            builtAnsWrapper = ansWrapper;
                        }
                        if (!answerHasRealContent) {
                            console.warn('[组卷打印] 答案附末尾未收集：第 ' + questionIndex + ' 题'
                                + '，opt=' + (opt ? '有' : '无')
                                + '，answerSel=' + JSON.stringify(profile.answerSel));
                        }
                    } else if (includeA) {
                        // 内联答案：并入题目块内——「题干+考点+答案」为一个整体块（与组卷网一致），
                        // 选中/删除/加行/分页都按一个单元处理。答案内容仍包 .zujuanjs-answer-item 保持样式钩子。
                        // （历史：曾拆成独立块以便分页时整体挪页；现分页块内拆分逻辑已成熟，按用户要求合并。）
                        const answerItem = document.createElement('div');
                        answerItem.className = 'zujuanjs-answer-item';
                        answerItem.style.fontFamily = font;
                        answerItem.style.fontSize = size;
                        answerItem.style.lineHeight = lineHeight;
                        if (pendingKpBox) {
                            answerItem.appendChild(pendingKpBox);
                            pendingKpBox = null;
                        }
                        answerItem.appendChild(optClone);
                        (questionBody || qDiv).appendChild(answerItem);
                    }
                }

                if (pendingKpBox) {
                    // 考点退回题干之后：无答案块可挂（未勾选答案/答案为空/抓取失败），
                    // 或「答案附末尾」模式——考点不随答案到卷末，仍留在题目下方
                    questionBody.appendChild(pendingKpBox);
                    pendingKpBox = null;
                }
                qWrapper.appendChild(qDiv);
                tempDiv.appendChild(qWrapper);
                if (pendingInlineAnswer) {
                    tempDiv.appendChild(pendingInlineAnswer);
                    pendingInlineAnswer = null;
                }
                // [P1.1] 按内容签名缓存已处理片段：内联含答案的片段仅在答案就绪时缓存，避免缓存空壳；
                // 附末尾的答案块（builtAnsWrapper）仅在内容非空时单独缓存。签名已覆盖题型开关/字体字号行距/源内容，
                // 任一变化即 miss 重处理，复用安全。缓存值为游离节点，复用时一律 cloneNode(true)。
                const cacheQuestion = (includeA && !atEnd) ? ansReady : true;
                if (cacheQuestion) {
                    this._cacheFragment(fragSig, {
                        q: qWrapper,
                        a: (atEnd && answerHasRealContent) ? builtAnsWrapper : null
                    });
                }
                questionIndex++;
            });

            if (atEnd && !answersEndList.length) {
                console.warn('[组卷打印] 勾选了「答案附末尾」但没有任何答案条目，答案页不会生成'
                    + '（可能未点击「获取答案/考点」抓取，或该站点无答案数据）');
            }
            if (atEnd && answersEndList.length) {
                // 1) 强制分页：题目结束后答案从新页开始
                const breakEl = document.createElement('div');
                breakEl.className = 'page-break zujuanjs-answers-break';
                tempDiv.appendChild(breakEl);
                // 2) "参考答案" 标题（居中加粗，打印时顶格显示）
                const section = document.createElement('div');
                section.className = 'zujuanjs-section-title zujuanjs-answers-header';
                section.style.fontFamily = font;
                section.style.textAlign = 'center';
                section.style.borderLeft = 'none';
                section.style.paddingLeft = '0';
                section.style.fontSize = '1.4em';
                section.textContent = '参考答案';
                tempDiv.appendChild(section);
                answersEndList.forEach(a => tempDiv.appendChild(a));
            }

            this.preparePreviewTypography(tempDiv);

            tempDiv.querySelectorAll('img').forEach(img => {
                if (img.src) img.setAttribute('src', img.src);
            });

            const contentFlags = Array.isArray(layoutOptions.contentFlags) ? layoutOptions.contentFlags : ['q'];
            const answersAtEnd = Boolean(layoutOptions.answersAtEnd);
            // 诊断：生成阶段重复块检测（重复说明源节点被处理了两次）
            try {
                const ids = Array.from(tempDiv.querySelectorAll('.q-wrapper')).map(el => el.dataset.blockId);
                const dup = ids.filter((id, idx) => ids.indexOf(id) !== idx);
                if (dup.length) console.warn('[组卷打印] 生成内容存在重复块 id：', dup);
            } catch (e) { /* 忽略 */ }
            // 负号字符归一（含公式外）：菁优网源数据负号字符混乱（U+2212 / U+FF0D / ASCII '-'），
            // 且负号不一定在公式内部——如「-π」里负号是选项纯文本、π 才是 MathJye 公式，
            // 只扫 .MathJye 子树会漏掉它（batch85/86 无效的原因）。
            // 统一目标为 U+2212：JyeooHai-Main-Regular 缺该字形、回退 Times New Roman，
            // 渲染出标准长度的数学减号（全角－在 Main 里字形偏短，正是「忽大忽小」的短）。
            // 规则：① 所有 U+2212 / U+FF0D → U+2212；② 公式子树内 ASCII '-' 一律视为负号；
            // ③ 公式外 ASCII '-' 仅当后面紧跟数字/π/√/括号（含空白）才视为负号，避免误伤普通连字符；
            // ④ 文本节点以负号结尾且下一个兄弟元素是 .MathJye（「-公式」模式）。幂等，每次生成执行。
            try {
                const fixMinusInNode = (node, mathScope) => {
                    let t = node.textContent;
                    let u = t.replace(/[\u2212\uFF0D]/g, '\u2212');
                    u = mathScope
                        ? u.replace(/-/g, '\u2212')
                        : u.replace(/-(?=[0-9\u03c0\u221a(\uFF08]|\s*[0-9\u03c0\u221a(\uFF08])/g, '\u2212');
                    if (u !== t) node.textContent = u;
                    return node.textContent;
                };
                const minusWalker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null);
                const minusTexts = [];
                let minusNode;
                while ((minusNode = minusWalker.nextNode())) minusTexts.push(minusNode);
                minusTexts.forEach(node => {
                    const mathScope = !!(node.parentElement && node.parentElement.closest('.MathJye'));
                    const fixed = fixMinusInNode(node, mathScope);
                    // 「-公式」模式：文本节点以负号结尾、下一个兄弟元素是 .MathJye
                    if (/[\u2212-]$/.test(fixed)) {
                        const nextEl = node.nextElementSibling;
                        if (nextEl && nextEl.classList.contains('MathJye')) {
                            node.textContent = fixed.slice(0, -1) + '\u2212';
                        }
                    }
                });
            } catch (e) { /* 忽略 */ }
            return {
                html: tempDiv.innerHTML,
                font, size, lineHeight, title, titleSize, pageFont, pageSize, pageBold,
                showPageNumber, marginTop, marginRight, marginBottom, marginLeft,
                questionSpacing, previewLayout, previewZoom, paragraphSpacing, contentAlign,
                numberGap, pageGap, editorPanelWidth, editorPanelTab,
                editorOpen, documentEdits, readingAnchor, contentFlags, answersAtEnd,
                baseAnswerLinesByType,
                contentWidth, contentHeight, footerBottom
            };
        }

        generatePreviewHTML(opts = {}) {
            const src = this.generateSourceContentHTML(opts);
            const { html: contentHtml, font, size, lineHeight, title, titleSize, pageFont, pageSize, pageBold, showPageNumber, marginTop, marginRight, marginBottom, marginLeft, questionSpacing, previewLayout, previewZoom, paragraphSpacing, contentAlign, numberGap, pageGap, editorPanelWidth, editorPanelTab, editorOpen, documentEdits, readingAnchor, contentFlags, answersAtEnd, baseAnswerLinesByType, contentWidth, contentHeight, footerBottom } = src;
            const previewSettingsJson = JSON.stringify({
                mode: 'q', font, size, lineHeight, title, titleSize: `${titleSize}px`,
                pageFont, pageSize, pageBold, showPageNumber, pageMargins: `${marginTop},${marginRight},${marginBottom},${marginLeft}`,
                questionSpacing: String(questionSpacing), previewLayout, previewZoom,
                paragraphSpacing: String(paragraphSpacing), contentAlign, numberGap: String(numberGap),
                pageGap: String(pageGap),
                baseAnswerLinesByType,
                editorPanelWidth: String(editorPanelWidth), editorPanelTab, editorOpen, documentEdits, readingAnchor,
                layoutPreset: (opts.layoutOptions && opts.layoutOptions.layoutPreset) || 'compact',
                contentFlags, answersAtEnd,
                autoCheckIn: GM_getValue('zujuanjsAutoCheckIn', false) === true,
                selfCheck: GM_getValue('zujuanjsSelfCheck', false) === true,
                // 站点能力：菁优网的答案/考点需从单题页抓取，预览面板据此显示「获取答案/考点」按钮
                siteDetailFetch: !!getSiteProfile().detailFetch,
                layoutPresets: LAYOUT_PRESETS,
                schema: PREVIEW_SETTING_SCHEMA,
                token: PREVIEW_TOKEN
            }).replace(/</g, '\\u003c');
            const fontWeight = pageBold ? 'bold' : 'normal';
            // [调试] 公式排版诊断开关：菁优网页面 URL 加 #formuladebug 即可在预览控制台输出分数尺寸
            const debugFormula = /formuladebug/i.test(location.hash || '') || GM_getValue('zujuanjsFormulaDebug', false) === true;

            // 站点公式样式（菁优网等 HTML+CSS 公式引擎）：注入预览，缺失会导致公式排版塌陷。
            // 规则由 prefetchSiteAssets() 在打开预览前异步抓取并缓存（含跨域样式表），此处仅读取缓存。
            const siteProfile = getSiteProfile();
            const siteFormulaCss = (() => {
                if (siteProfile.formulaKind !== 'html-css') return '';
                try { return _siteCssCache.get(siteCssCacheKey(siteProfile)) || ''; } catch (e) { return ''; }
            })();
            const siteExtraCss = SITE_EXTRA_CSS[siteProfile.id] || '';
            // 站点公式样式抓取失败时追加最小兜底，避免公式逐行堆叠
            const siteFallbackCss = (siteProfile.formulaKind === 'html-css' && !siteFormulaCss)
                ? SITE_FORMULA_FALLBACK_CSS
                : '';
            const siteStyleCss = (siteFormulaCss + '\n' + siteFallbackCss + '\n' + siteExtraCss).trim();
            const siteFormulaStyle = siteStyleCss
                ? `<style data-zujuan-formula="1">${siteStyleCss.replace(/<\//g, '<\\/')}</style>`
                : '';

            // 由内容块注册表驱动生成「打印内容」复选框（试题锁定置灰，其余可选）。
            // 站点不提供答案/知识点时（菁优网），只保留「试题」，避免勾选后无内容的空操作。
            const siteProfileForUi = getSiteProfile();
            const siteHasAnswers = siteProfileForUi.hasAnswers;
            const contentCheckboxesHtml = CONTENT_BLOCKS.filter(b => {
                if (b.key === 'q') return true;
                if (b.key === 'a') return !!siteHasAnswers;
                if (b.key === 'kp') return siteProfileForUi.hasKnowledge !== false;
                return false;
            }).map(b => {
                const locked = b.locked;
                const inputStyle = 'accent-color:#1677ff;width:14px;height:14px;' + (locked ? 'opacity:0.6;' : '');
                const labelStyle = `display:inline-flex;align-items:center;gap:4px;cursor:${locked ? 'not-allowed' : 'pointer'};font-size:13px;color:${locked ? '#bbb' : '#434343'};`;
                const attrs = locked ? ' checked disabled data-locked="1"' : '';
                return `<label style="${labelStyle}"><input type="checkbox" name="setting-content" value="${b.key}" style="${inputStyle}"${attrs}>${b.label}</label>`;
            }).join('');

            return `
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>A4 试卷预览</title>
                <link rel="stylesheet" href="https://cdn.staticfile.net/twitter-bootstrap/5.3.3/css/bootstrap.min.css" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous" referrerpolicy="no-referrer" data-zujuan-ui="bootstrap">
                ${siteFormulaStyle}
                <style>
                    body { margin: 0; background: #525659; font-family: sans-serif; padding-bottom: 40px; }

                    .preview-toolbar {
                        position: fixed; top: 0; left: 0; right: 0; height: 50px;
                        background: #333; color: #fff; display: flex; align-items: center;
                        justify-content: center; gap: 15px; z-index: 1000;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    }
                    .preview-toolbar button {
                        background: #1677ff; color: #fff; border: none; padding: 8px 22px;
                        border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;
                        transition: background 0.2s;
                    }
                    .preview-toolbar button:hover { background: #4096ff; }
                    .preview-toolbar button.close { background: #ff4d4f; }
                    .preview-toolbar button.close:hover { background: #ff7875; }
                    .preview-hint { font-size: 12px; color: #aaa; margin-right: 20px; }

                    /* A4 纸张渲染 */
                    .paper-container { padding-top: 70px; }
                    .paper {
                        width: 210mm;
                        min-height: 297mm;
                        background: #fff;
                        margin: 0 auto 20px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                        box-sizing: border-box;
                        position: relative;
                        overflow: hidden;
                    }
                    .paper-inner {
                        padding: 18mm 15mm 22mm 15mm;
                        position: relative;
                        box-sizing: border-box;
                        min-height: 297mm;
                    }
                    .content-wrapper { position: relative; z-index: 2; }

                    .q-wrapper { position: relative; padding-top: 15px; margin-bottom: 10px; page-break-inside: avoid; }
                    .q-toolbar {
                        position: absolute; top: -12px; right: 0;
                        background: rgba(22, 119, 255, 0.9); border-radius: 4px; padding: 2px;
                        display: flex; gap: 2px; opacity: 0; transition: opacity 0.2s; z-index: 10;
                    }
                    .q-wrapper:hover .q-toolbar,
                    .q-wrapper:focus-within .q-toolbar { opacity: 1; }
                    .q-toolbar button {
                        background: transparent; color: #fff; border: none;
                        padding: 3px 8px; font-size: 11px; cursor: pointer; border-radius: 2px;
                    }
                    .q-toolbar button:hover { background: rgba(255,255,255,0.2); }

                    .answer-blank,
                    .answer-blank-large {
                        display: block;
                        width: 100%;
                        margin-top: 4px;
                        border: 0;
                        background: transparent;
                        page-break-inside: avoid;
                    }
                    .answer-blank { height: 1.8em; }
                    .answer-blank-large { height: 12em; }

                    /* JS 动态插入的自然分页占位符 */
                    .auto-page-spacer {
                        position: relative;
                        width: 100%;
                        pointer-events: none;
                    }
                    .page-break-line {
                        position: absolute;
                        bottom: 0;
                        left: 0;
                        right: 0;
                        border-bottom: 2px dashed #1677ff;
                        color: #1677ff;
                        font-size: 12px;
                        text-align: center;
                        padding-bottom: 5px;
                        background: #fff;
                    }

                    /* 用户手动插入的分页符 (红色) */
                    .page-break {
                        border-top: 2px dashed #ff4d4f; margin: 15px 0; position: relative; height: 0; z-index: 3; page-break-inside: avoid;
                    }
                    .page-break::after {
                        content: "↓ 强制分页符 (打印时在此处换页) ↓";
                        position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
                        background: #fff; color: #ff4d4f; font-size: 12px; padding: 0 8px; white-space: nowrap;
                    }

                    .zujuanjs-section-title { display: flow-root; font-size: 1.25em; font-weight: bold; margin: 0 0 12px; padding-top: 22px; border-left: 4px solid #000; padding-left: 8px; page-break-inside: avoid; page-break-after: avoid; }
                    /* 参考答案标题：强制从新页开始（打印模式） */
                    .zujuanjs-answers-header { break-before: page; page-break-before: always; border-left: none; }
                    .zujuanjs-print-title { font-size: var(--title-size, 24px); text-align: center; font-weight: bold; margin: 15px 0 30px; line-height: 1.4; page-break-inside: avoid; }
                    .zujuanjs-question { margin-bottom: 18px; padding: 4px 0; border-bottom: none; }
                    .zujuanjs-question-number { font-weight: bold; white-space: pre; }
                    .zujuanjs-answer-item { margin-bottom: 18px; padding: 4px 0; border: none; }
                    .zujuanjs-answer-title { font-weight: bold; margin-bottom: 6px; }
                    .zujuanjs-knowledge-points { font-size: 0.9em; color: inherit; line-height: 1.6; }
                    img { max-width: 100%; }

                    @media print {
                        body { background: #fff; margin: 0; padding: 0; }
                        .preview-toolbar { display: none !important; }
                        .paper-container { padding: 0; }
                        .paper {
                            width: 100%; min-height: 0; margin: 0; box-shadow: none; padding: 0; overflow: visible;
                        }
                        .paper-inner { padding: 0; min-height: 0; }
                        .q-toolbar { display: none !important; }
                        .page-break-line { display: none !important; }
                        .page-break {
                            border: none; margin: 0; height: 0;
                        }
                        .page-break::after { display: none; }

                        .zujuanjs-print-title, .zujuanjs-section-title, .zujuanjs-question, .zujuanjs-answer-item, .zujuanjs-answer-title {
                            color: #000 !important;
                        }
                        .zujuanjs-section-title { border-left-color: #000 !important; }
                        img { filter: grayscale(100%) contrast(120%); }
                        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                    }

                    /* ===== 5.3: 类 Word 的独立 A4 多页预览 ===== */
                    #source-content { display: none !important; }
                    .paper-container {
                        padding: 70px 24px 40px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 20px;
                        overflow-x: auto;
                    }
                    .paper {
                        width: 210mm;
                        height: 297mm;
                        min-height: 297mm;
                        margin: 0;
                        flex: 0 0 auto;
                        overflow: hidden;
                        background: #fff;
                        box-shadow: 0 4px 14px rgba(0,0,0,0.38);
                        position: relative;
                        box-sizing: border-box;
                    }
                    .paper-content {
                        position: absolute;
                        top: 18mm;
                        right: 15mm;
                        bottom: 22mm;
                        left: 15mm;
                        width: 180mm;
                        height: 257mm;
                        overflow: hidden;
                        box-sizing: border-box;
                        display: flow-root;
                        font-family: ${font};
                        font-size: ${size};
                        line-height: ${lineHeight};
                    }
                    .paper-content img { max-height: 245mm; object-fit: contain; }
                    .page-footer {
                        position: absolute;
                        left: 15mm;
                        right: 15mm;
                        bottom: 7mm;
                        text-align: center;
                        color: #000;
                        font-family: ${pageFont};
                        font-size: ${pageSize};
                        font-weight: ${fontWeight};
                        line-height: 1;
                    }
                    .q-wrapper {
                        position: relative;
                        padding-top: 3px;
                        margin-bottom: 10px;
                        break-inside: auto;
                        page-break-inside: auto;
                    }
                    .q-wrapper.continued-from-previous { padding-top: 0; }
                    .q-wrapper.continues-on-next { margin-bottom: 0; }
                    .q-wrapper.continues-on-next .zujuanjs-question,
                    .q-wrapper.continues-on-next .zujuanjs-answer-item { margin-bottom: 0; }
                    .q-wrapper.continued-from-previous .zujuanjs-question,
                    .q-wrapper.continued-from-previous .zujuanjs-answer-item { padding-top: 0; }
                    .q-toolbar { top: -14px; }
                    .manual-break-indicator { display: none; }
                    .preview-page-count { min-width: 52px; font-size: 12px; color: #d0d0d0; }

                    @media screen and (max-width: 850px) {
                        .paper-container { align-items: flex-start; padding-left: 12px; padding-right: 12px; }
                        .preview-hint { display: none; }
                        .preview-toolbar { justify-content: flex-start; padding: 0 10px; box-sizing: border-box; }
                    }

                    @media print {
                        @page { size: A4; margin: 0 !important; }
                        html, body { width: 210mm; margin: 0 !important; padding: 0 !important; background: #fff; }
                        .paper-container { display: block; padding: 0; margin: 0; overflow: visible; }
                        .paper {
                            width: 210mm;
                            height: 297mm;
                            min-height: 297mm;
                            margin: 0;
                            box-shadow: none;
                            overflow: hidden;
                            break-after: page;
                            page-break-after: always;
                        }
                        .paper:last-child { break-after: auto; page-break-after: auto; }
                        .paper-content { top: 18mm; right: 15mm; bottom: 22mm; left: 15mm; width: 180mm; height: 257mm; }
                        .q-toolbar, .manual-break-indicator { display: none !important; }
                    }

                    /* ===== 5.4: 双页并排、自动缩放与精简工具栏 ===== */
                    :root {
                        --preview-scale: 1;
                        --paper-display-width: 793.7px;
                        --paper-display-height: 1122.52px;
                    }
                    html { scrollbar-gutter: stable; }
                    body { min-height: 100vh; padding: 0; background: #45484b; letter-spacing: 0; }
                    .preview-toolbar {
                        height: 56px;
                        padding: 0 14px;
                        justify-content: space-between;
                        gap: 12px;
                        background: #202224;
                        box-shadow: 0 1px 5px rgba(0,0,0,0.35);
                        box-sizing: border-box;
                    }
                    .toolbar-section { display: flex; align-items: center; gap: 8px; min-width: 0; }
                    .toolbar-segment,
                    .zoom-control {
                        display: flex;
                        align-items: center;
                        height: 34px;
                        padding: 2px;
                        border: 1px solid #45484b;
                        border-radius: 6px;
                        background: #2b2e31;
                        box-sizing: border-box;
                    }
                    .preview-toolbar button {
                        height: 28px;
                        min-width: 30px;
                        padding: 0 9px;
                        border: 0;
                        border-radius: 4px;
                        background: transparent;
                        color: #d6d9dc;
                        font-size: 12px;
                        font-weight: 500;
                        line-height: 28px;
                        letter-spacing: 0;
                        white-space: nowrap;
                    }
                    .preview-toolbar button:hover { background: #3b3f43; color: #fff; }
                    .preview-toolbar button.active { background: #fff; color: #202224; }
                    .preview-toolbar .print-action {
                        height: 34px;
                        padding: 0 15px;
                        border-radius: 5px;
                        background: #1677ff;
                        color: #fff;
                        line-height: 34px;
                    }
                    .preview-toolbar .print-action:hover { background: #0f68df; }
                    .preview-toolbar button.close {
                        width: 34px;
                        height: 34px;
                        min-width: 34px;
                        padding: 0;
                        border-radius: 5px;
                        background: transparent;
                        color: #d6d9dc;
                        font-size: 20px;
                        line-height: 32px;
                    }
                    .preview-toolbar button.close:hover { background: #c9363e; color: #fff; }
                    .zoom-control button { padding: 0; font-size: 18px; font-weight: 400; }
                    .zoom-value { min-width: 48px !important; padding: 0 4px !important; font-variant-numeric: tabular-nums; }
                    .preview-page-count {
                        min-width: 48px;
                        color: #b9bdc1;
                        font-size: 12px;
                        font-variant-numeric: tabular-nums;
                        white-space: nowrap;
                    }
                    .paper-container {
                        display: grid;
                        align-items: start;
                        justify-content: safe center;
                        gap: 20px;
                        padding: 76px 20px 40px;
                        overflow: visible;
                        box-sizing: border-box;
                    }
                    .paper-container.layout-single { grid-template-columns: var(--paper-display-width); }
                    .paper-container.layout-double { grid-template-columns: repeat(2, var(--paper-display-width)); }
                    .paper-shell {
                        width: var(--paper-display-width);
                        height: var(--paper-display-height);
                        position: relative;
                        overflow: visible;
                    }
                    .paper {
                        width: 210mm;
                        height: 297mm;
                        min-height: 297mm;
                        margin: 0;
                        transform: scale(var(--preview-scale));
                        transform-origin: top left;
                        box-shadow: 0 3px 12px rgba(0,0,0,0.4);
                    }
                    .paper-content {
                        top: ${marginTop}mm;
                        right: ${marginRight}mm;
                        bottom: ${marginBottom}mm;
                        left: ${marginLeft}mm;
                        width: ${contentWidth}mm;
                        height: ${contentHeight}mm;
                    }
                    .paper-content img { max-height: ${Math.max(20, contentHeight - 12)}mm; }
                    .page-footer {
                        left: ${marginLeft}mm;
                        right: ${marginRight}mm;
                        bottom: ${footerBottom}mm;
                    }
                    .q-wrapper { margin-bottom: ${questionSpacing}px; }
                    .zujuanjs-question, .zujuanjs-answer-item { margin-bottom: 0; }

                    @media screen and (max-width: 680px) {
                        .preview-toolbar { padding: 0 8px; gap: 7px; overflow-x: auto; }
                        .toolbar-section { gap: 5px; }
                        .preview-toolbar .print-action { width: 34px; min-width: 34px; padding: 0; font-size: 16px; }
                        .print-action-label { display: none; }
                        .paper-container { padding-left: 12px; padding-right: 12px; gap: 12px; }
                    }

                    @media print {
                        .paper-container { display: block !important; padding: 0 !important; }
                        .paper-shell {
                            width: 210mm !important;
                            height: 297mm !important;
                            margin: 0 !important;
                            break-after: page;
                            page-break-after: always;
                        }
                        .paper-shell:last-child { break-after: auto; page-break-after: auto; }
                        .paper {
                            transform: none !important;
                            break-after: auto !important;
                            page-break-after: auto !important;
                        }
                        .paper-content {
                            top: ${marginTop}mm;
                            right: ${marginRight}mm;
                            bottom: ${marginBottom}mm;
                            left: ${marginLeft}mm;
                            width: ${contentWidth}mm;
                            height: ${contentHeight}mm;
                        }
                    }

                    /* ===== 5.5: 预览内实时排版工具 ===== */
                    :root {
                        --question-font: ${font};
                        --question-size: ${size};
                        --question-line-height: ${lineHeight};
                        --page-font: ${pageFont};
                        --page-size: ${pageSize};
                        --page-weight: ${fontWeight};
                        --page-margin-top: ${marginTop}mm;
                        --page-margin-right: ${marginRight}mm;
                        --page-margin-bottom: ${marginBottom}mm;
                        --page-margin-left: ${marginLeft}mm;
                        --page-content-width: ${contentWidth}mm;
                        --page-content-height: ${contentHeight}mm;
                        --page-image-max-height: ${Math.max(20, contentHeight - 12)}mm;
                        --page-footer-bottom: ${footerBottom}mm;
                        --question-spacing: ${questionSpacing}px;
                        --title-size: ${titleSize}px;
                    }
                    .editor-toggle { font-size: 17px !important; }
                    .editor-panel {
                        position: fixed;
                        top: 56px;
                        right: 0;
                        bottom: 0;
                        z-index: 900;
                        width: 318px;
                        border-left: 1px solid #d8dadd;
                        background: #fff;
                        box-shadow: -4px 0 16px rgba(0,0,0,0.14);
                        transform: translateX(100%);
                        transition: transform 0.18s ease;
                        overflow-y: auto;
                        overscroll-behavior: contain;
                    }
                    .editor-panel.editor-initializing { transition: none; }
                    body.editor-open .editor-panel { transform: translateX(0); }
                    body.editor-open .paper-container { padding-right: 338px; }
                    .editor-panel-header {
                        position: sticky;
                        top: 0;
                        z-index: 2;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        height: 48px;
                        padding: 0 12px 0 16px;
                        border-bottom: 1px solid #e5e7ea;
                        background: #fff;
                        color: #202124;
                        font-size: 14px;
                        font-weight: 650;
                        box-sizing: border-box;
                    }
                    .editor-panel-header button {
                        width: 28px;
                        height: 28px;
                        padding: 0;
                        border: 0;
                        border-radius: 4px;
                        background: transparent;
                        color: #555b61;
                        font-size: 20px;
                        line-height: 26px;
                        cursor: pointer;
                    }
                    .editor-panel-header button:hover { background: #eef0f2; color: #1e2328; }
                    .editor-section { padding: 13px 16px; border-bottom: 1px solid #eceef0; }
                    .editor-section-title { margin: 0 0 10px; color: #34383d; font-size: 12px; font-weight: 650; }
                    .editor-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
                    .editor-field { display: grid; gap: 5px; min-width: 0; color: #6d737a; font-size: 11px; }
                    .editor-field.wide { grid-column: 1 / -1; }
                    .editor-field input,
                    .editor-field select {
                        width: 100%;
                        height: 32px;
                        padding: 0 8px;
                        border: 1px solid #d3d7db;
                        border-radius: 4px;
                        background: #fff;
                        color: #25292d;
                        font: inherit;
                        font-size: 12px;
                        box-sizing: border-box;
                        outline: none;
                    }
                    .editor-field input:focus,
                    .editor-field select:focus { border-color: #1677ff; box-shadow: 0 0 0 2px rgba(22,119,255,0.14); }
                    .base-lines-grid { display: grid; grid-template-columns: 1fr minmax(90px, 0.5fr); gap: 6px 8px; align-items: center; width: 100%; }
                    .base-lines-grid.wide { grid-column: 1 / -1; }
                    .base-lines-grid .bl-label { color: #6d737a; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 28px; }
                    .bl-stepper { display: flex; align-items: stretch; height: 28px; min-width: 0; border: 1px solid #d3d7db; border-radius: 4px; overflow: hidden; box-sizing: border-box; }
                    .bl-stepper .bl-stepper-btn { width: 26px; flex: 0 0 26px; border: none; border-right: 1px solid #d3d7db; background: #f5f6f7; color: #555; font-size: 15px; line-height: 1; cursor: pointer; -webkit-user-select: none; user-select: none; }
                    .bl-stepper .bl-stepper-btn + .bl-stepper-input-wrap + .bl-stepper-btn { border-right: none; border-left: 1px solid #d3d7db; }
                    .bl-stepper .bl-stepper-input-wrap { flex: 1 1 0; min-width: 0; position: relative; display: flex; align-items: center; justify-content: center; gap: 3px; padding: 0 6px 0 4px; }
                    .bl-stepper .bl-stepper-input-wrap input { flex: 1 1 auto; min-width: 0; width: auto; height: auto; border: none; padding: 0; text-align: center; background: #fff; color: #25292d; font-size: 12px; line-height: 1; outline: none; }
                    .bl-stepper .bl-stepper-input-wrap input::-webkit-outer-spin-button,
                    .bl-stepper .bl-stepper-input-wrap input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
                    .bl-stepper .bl-stepper-input-wrap input[type=number] { -moz-appearance: textfield; }
                    .bl-stepper .bl-stepper-input-wrap span { position: static; transform: none; color: #888; font-size: 11px; line-height: 1; pointer-events: none; white-space: nowrap; }
                    .bl-stepper .bl-stepper-btn:hover { background: #e9ecef; }
                    .bl-stepper .bl-stepper-btn:active { background: #dde1e5; }
                    .bl-stepper:has(.bl-stepper-input-wrap input:focus) { border-color: #1677ff; box-shadow: 0 0 0 2px rgba(22,119,255,0.14); }
                    .bl-stepper .bl-stepper-input-wrap input.form-control-sm:focus { border-color: transparent; box-shadow: none; background: #fff; }
                    .editor-separator { height: 1px; background: #e4ebe8; margin: 6px 0; grid-column: 1 / -1; }
                    .editor-margin-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
                    .editor-margin-grid .editor-field { gap: 3px; font-size: 10px; }
                    .editor-margin-grid input { padding: 0 5px; text-align: center; }
                    .editor-check { display: flex; align-items: center; gap: 7px; min-height: 32px; color: #34383d; font-size: 12px; }
                    .editor-check input { width: 15px; height: 15px; margin: 0; accent-color: #1677ff; }
                    .editor-reset {
                        width: 100%;
                        height: 32px;
                        border: 1px solid #d3d7db;
                        border-radius: 4px;
                        background: #fff;
                        color: #40454a;
                        font-size: 12px;
                        cursor: pointer;
                    }
                    .editor-reset:hover { border-color: #9ba1a7; background: #f7f8f9; }
                    .paper-content {
                        top: var(--page-margin-top) !important;
                        right: var(--page-margin-right) !important;
                        bottom: var(--page-margin-bottom) !important;
                        left: var(--page-margin-left) !important;
                        width: var(--page-content-width) !important;
                        height: var(--page-content-height) !important;
                        font-family: var(--question-font) !important;
                        font-size: var(--question-size) !important;
                        line-height: var(--question-line-height) !important;
                    }
                    .paper-content img { max-height: var(--page-image-max-height) !important; }
                    .page-footer {
                        left: var(--page-margin-left) !important;
                        right: var(--page-margin-right) !important;
                        bottom: var(--page-footer-bottom) !important;
                        font-family: var(--page-font) !important;
                        font-size: var(--page-size) !important;
                        font-weight: var(--page-weight) !important;
                    }
                    .q-wrapper { margin-bottom: var(--question-spacing) !important; }
                    .zujuanjs-print-title { font-size: var(--title-size) !important; }
                    .zujuanjs-question-layout {
                        display: grid;
                        /* 题号列用固定宽度（而非 max-content）：否则列宽随题号位数浮动，
                           1. 与 15. 之后的题干起始位置不一致（15. 会明显偏右）。 */
                        grid-template-columns: 2.4em minmax(0, 1fr);
                        column-gap: 0.55em;
                        /* 基线对齐：题干首行可能含分数/根号等较高的元素，会把该行文字基线往下压；
                           若用 start（顶部对齐），题号就会显得比题干文字偏高、上下不在一条线。 */
                        align-items: baseline;
                        width: 100%;
                        min-width: 0;
                    }
                    .zujuanjs-question-number {
                        grid-column: 1;
                        /* 右对齐：个位数与两位数题号的句点对齐，结合固定列宽让所有题干起始位置一致 */
                        justify-self: end;
                        font-weight: bold;
                        white-space: nowrap;
                    }
                    .zujuanjs-question-number.continuation-placeholder { visibility: hidden; }
                    .zujuanjs-question-body {
                        grid-column: 2;
                        min-width: 0;
                    }
                    .zujuanjs-question-body > .exam-item__cnt,
                    .zujuanjs-question-body > .exam-item__opt { min-width: 0; }
                    .zujuanjs-question-body > .exam-item__cnt > :first-child,
                    .zujuanjs-question-body > :first-child { margin-top: 0 !important; }
                    .zujuanjs-question-body > .exam-item__opt:last-child,
                    .zujuanjs-question-body > :last-child { margin-bottom: 0; }
                    .zujuanjs-knowledge-points {
                        grid-column: 1 / -1;
                        font-size: 0.9em;
                        /* 颜色继承正文：原先的灰色会让【考点】标签与内容一起发灰 */
                        color: inherit;
                        line-height: 1.6;
                        margin-top: 4px;
                    }
                    @media screen and (max-width: 680px) {
                        .editor-panel {
                            top: auto;
                            left: 0;
                            width: auto;
                            max-height: min(68vh, 560px);
                            border-top: 1px solid #d8dadd;
                            border-left: 0;
                            transform: translateY(110%);
                            box-shadow: 0 -4px 16px rgba(0,0,0,0.18);
                        }
                        body.editor-open .paper-container {
                            padding-right: 12px;
                            padding-bottom: calc(min(68vh, 560px) + 24px);
                        }
                        body.editor-open .editor-panel { transform: translateY(0); }
                    }
                    @media print {
                        .editor-panel, .editor-toggle { display: none !important; }
                        .paper-container { padding-right: 0 !important; }
                    }

                    .preview-toolbar > .toolbar-section:first-child,
                    .preview-toolbar > .toolbar-section:last-child { flex: 1 1 0; }
                    .preview-toolbar > .toolbar-section:last-child { justify-content: flex-end; }
                    .preview-toolbar > .toolbar-section:nth-child(2) { flex: 0 0 auto; }
                    .preview-toolbar .btn-group {
                        display: inline-flex;
                        align-items: center;
                        height: 34px;
                        padding: 0;
                        border: 0;
                        border-radius: 6px;
                        background: #2b2e31;
                        overflow: hidden;
                        vertical-align: middle;
                    }
                    .preview-toolbar .btn,
                    .q-toolbar .btn,
                    .editor-panel .btn,
                    .editor-panel .form-control,
                    .editor-panel .form-select,
                    .editor-panel .form-check-input { box-sizing: border-box; }
                    .preview-toolbar .btn {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        gap: 5px;
                        height: 34px;
                        min-height: 34px;
                        min-width: 34px;
                        padding: 0 10px;
                        border: 1px solid transparent;
                        border-radius: 5px;
                        font-size: 12px;
                        font-weight: 500;
                        line-height: 1;
                        letter-spacing: 0;
                        white-space: nowrap;
                        cursor: pointer;
                        touch-action: manipulation;
                        transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
                    }
                    .preview-toolbar .btn-outline-light {
                        color: #d6d9dc;
                        border: 1px solid #45484b;
                        background: #2b2e31;
                    }
                    .preview-toolbar .btn-outline-light:hover,
                    .preview-toolbar .btn-outline-light:focus-visible {
                        color: #fff;
                        border-color: #6c737a;
                        background: #3b3f43;
                    }
                    .preview-toolbar .btn-outline-light.active,
                    .preview-toolbar .btn-outline-light[aria-pressed="true"] {
                        color: #202224;
                        border-color: #fff;
                        background: #fff;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.18);
                    }
                    .preview-toolbar .btn-primary {
                        color: #fff;
                        border-color: #1677ff;
                        background: #1677ff;
                    }
                    .preview-toolbar .btn-primary:hover,
                    .preview-toolbar .btn-primary:focus-visible { border-color: #0f68df; background: #0f68df; }
                    .preview-toolbar .toolbar-segment,
                    .preview-toolbar .zoom-control {
                        display: inline-flex;
                        align-items: center;
                        flex: 0 0 auto;
                    }
                    .preview-toolbar .btn-group > .btn {
                        position: relative;
                        margin: 0;
                        border-radius: 0 !important;
                    }
                    .preview-toolbar .btn-group > .btn + .btn { margin-left: -1px; }
                    .preview-toolbar .btn-group > .btn:first-child { border-radius: 5px 0 0 5px !important; }
                    .preview-toolbar .btn-group > .btn:last-child { border-radius: 0 5px 5px 0 !important; }
                    .preview-toolbar .btn-group:focus-within { box-shadow: 0 0 0 2px #69b1ff; }
                    .preview-toolbar .toolbar-segment .btn,
                    .preview-toolbar .zoom-control .btn { flex: 0 0 auto; }
                    .preview-toolbar .zoom-control .btn { padding: 0 7px; font-size: 17px; font-weight: 400; }
                    .preview-toolbar .zoom-control .zoom-value {
                        min-width: 58px;
                        padding: 0 5px;
                        font-size: 12px;
                        font-variant-numeric: tabular-nums;
                    }
                    .preview-toolbar .print-action {
                        height: 34px;
                        min-height: 34px;
                        min-width: 34px;
                        padding: 0 15px;
                        border-radius: 5px;
                        line-height: 1;
                    }
                    .preview-toolbar .editor-toggle { font-size: 16px; }
                    .preview-toolbar button.close {
                        width: 34px;
                        height: 34px;
                        min-width: 34px;
                        min-height: 34px;
                        padding: 0;
                        border: 1px solid #45484b;
                        background: #2b2e31;
                        font-size: 16px;
                        line-height: 1;
                    }
                    .preview-toolbar button.close:hover,
                    .preview-toolbar button.close:focus-visible { border-color: #c9363e; background: #c9363e; color: #fff; }
                    .toolbar-icon {
                        display: block;
                        width: 15px;
                        height: 15px;
                        flex: 0 0 auto;
                        fill: currentColor;
                    }
                    .preview-page-count {
                        display: inline-flex;
                        align-items: center;
                        height: 34px;
                    }
                    .q-toolbar {
                        display: flex;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 3px;
                        padding: 4px;
                    }
                    .q-toolbar .btn {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        height: 26px;
                        min-height: 26px;
                        min-width: 0;
                        padding: 0 8px;
                        border: 0;
                        border-radius: 3px;
                        color: #174f8c;
                        background: rgba(255,255,255,0.96);
                        font-size: 11px;
                        font-weight: 600;
                        line-height: 1;
                        white-space: nowrap;
                    }
                    .q-toolbar .btn:hover,
                    .q-toolbar .btn:focus-visible { color: #0e3b6a; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.18); }
                    #paper-container .q-wrapper:focus-within > .q-toolbar,
                    #source-content .q-wrapper:focus-within > .q-toolbar { opacity: 1 !important; }
                    .preview-toolbar .btn:focus-visible,
                    .q-toolbar .btn:focus-visible,
                    .editor-panel .btn:focus-visible {
                        position: relative;
                        z-index: 2;
                        outline: 2px solid #69b1ff;
                        outline-offset: 1px;
                    }
                    .editor-panel .form-control,
                    .editor-panel .form-select {
                        width: 100%;
                        height: 32px;
                        min-height: 32px;
                        padding: 0 8px;
                        border: 1px solid #d3d7db;
                        border-radius: 4px;
                        background-color: #fff;
                        color: #25292d;
                        font: inherit;
                        font-size: 12px;
                        line-height: 1.2;
                        outline: none;
                    }
                    .editor-panel .form-select { padding-right: 28px; }
                    .editor-panel .form-control:focus,
                    .editor-panel .form-select:focus {
                        border-color: #1677ff;
                        box-shadow: 0 0 0 2px rgba(22,119,255,0.14);
                    }
                    .editor-panel .form-check-input {
                        width: 15px;
                        height: 15px;
                        margin: 0;
                        accent-color: #1677ff;
                        flex: 0 0 auto;
                    }
                    .editor-panel-header .btn {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 28px;
                        height: 28px;
                        min-height: 28px;
                        padding: 0;
                        border: 0;
                        border-radius: 4px;
                        background: transparent;
                        color: #555b61;
                        font-size: 20px;
                        line-height: 1;
                    }
                    .editor-panel-header .btn:hover,
                    .editor-panel-header .btn:focus-visible { background: #eef0f2; color: #1e2328; }
                    .editor-panel .editor-reset {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 100%;
                        height: 32px;
                        min-height: 32px;
                        padding: 0 12px;
                        border: 1px solid #c8cdd2;
                        border-radius: 4px;
                        color: #40454a;
                        background: #fff;
                        font-size: 12px;
                        line-height: 1;
                    }
                    .editor-panel .editor-reset:hover,
                    .editor-panel .editor-reset:focus-visible { border-color: #9ba1a7; background: #f7f8f9; }
                    .editor-grid > .wide { grid-column: 1 / -1; }

                    #source-content *,
                    #paper-container * { box-sizing: content-box; }
                    #paper-container,
                    #paper-container .paper-shell,
                    #paper-container .paper,
                    #paper-container .paper-content { box-sizing: border-box; }
                    /* MathJye 组件在 mathJye.css 中声明 box-sizing: border-box，预览必须保持一致 —— 实测对比：
                         原站 math-letter 为 border-box、fracZi 高 12px；改成 content-box 后 padding-top 会额外撑高元素，
                         fracZi 变为 22px、分子被垫高约 10px，而 .fracMu 的 top 是固定像素，
                         于是分子 / 分数线 / 分母的相对位置全部失配。结论：这层盒模型不要改动，与站点一致。 */
                    #source-content .MathJye,
                    #source-content .MathJye *,
                    #paper-container .MathJye,
                    #paper-container .MathJye * { box-sizing: border-box; }
                    /* 分数线同样按站点声明，显式兜底 */
                    #source-content .fracLine,
                    #paper-container .fracLine,
                    #source-content .fracLine *,
                    #paper-container .fracLine * { box-sizing: border-box !important; }
                    #source-content .q-toolbar *,
                    #paper-container .q-toolbar *,
                    .preview-toolbar *,
                    .editor-panel * { box-sizing: border-box; }
                    #source-content p,
                    #paper-container p { margin: 1em 0; }
                    #source-content h1,
                    #source-content h2,
                    #source-content h3,
                    #source-content h4,
                    #source-content h5,
                    #source-content h6,
                    #paper-container h1,
                    #paper-container h2,
                    #paper-container h3,
                    #paper-container h4,
                    #paper-container h5,
                    #paper-container h6 { margin: revert; font-size: revert; font-weight: revert; line-height: revert; }
                    #source-content ul,
                    #source-content ol,
                    #source-content dl,
                    #paper-container ul,
                    #paper-container ol,
                    #paper-container dl { margin: revert; padding: revert; }
                    #source-content table,
                    #paper-container table { border-collapse: revert; border-spacing: revert; }
                    #source-content blockquote,
                    #source-content figure,
                    #paper-container blockquote,
                    #paper-container figure { margin: revert; }
                    #source-content img,
                    #source-content svg,
                    #paper-container img,
                    #paper-container svg { vertical-align: revert; }
                    #source-content th,
                    #source-content td,
                    #paper-container th,
                    #paper-container td {
                        padding: revert;
                        border-color: revert;
                        text-align: revert;
                    }
                    #source-content a,
                    #paper-container a { color: revert; text-decoration: revert; }
                    #source-content pre,
                    #source-content code,
                    #source-content kbd,
                    #source-content samp,
                    #paper-container pre,
                    #paper-container code,
                    #paper-container kbd,
                    #paper-container samp { font-family: revert; font-size: revert; }

                    @media screen and (max-width: 680px) {
                        .paper-container.layout-double { grid-template-columns: var(--paper-display-width); }
                        .preview-toolbar {
                            justify-content: flex-start;
                            overflow-x: auto;
                            scrollbar-width: none;
                        }
                        .preview-toolbar::-webkit-scrollbar { display: none; }
                        .preview-toolbar > .toolbar-section { flex: 0 0 auto !important; }
                        .preview-page-count { display: none; }
                        .preview-toolbar .btn { padding-left: 8px; padding-right: 8px; }
                        .preview-toolbar .print-action { width: 34px; padding: 0; }
                    }
                    @media screen and (max-width: 480px) {
                        .layout-label, .print-action-label { display: none; }
                        .preview-toolbar .toolbar-segment .btn { width: 36px; padding: 0; }
                    }
                    @media screen and (max-width: 360px) {
                        .preview-toolbar { gap: 5px; padding-left: 6px; padding-right: 6px; }
                        .preview-toolbar .toolbar-section { gap: 4px; }
                        .preview-toolbar .zoom-control [data-zoom="out"],
                        .preview-toolbar .zoom-control [data-zoom="in"] { display: none; }
                        .preview-toolbar .zoom-control .zoom-value { min-width: 50px; }
                    }
                    @media (hover: none), (pointer: coarse) {
                        .q-toolbar { opacity: 1; }
                    }

                    /* ===== 5.8: Word 式工作区、可调宽侧栏与顶层题目工具条 ===== */
                    :root {
                        --toolbar-height: 56px;
                        --editor-panel-width: ${editorPanelWidth}px;
                        --page-gap: ${pageGap}px;
                        --paragraph-spacing: ${paragraphSpacing}px;
                        --number-gap: ${numberGap}em;
                        --content-align: ${contentAlign};
                    }
                    html, body {
                        width: 100%;
                        height: 100%;
                        margin: 0;
                        overflow: hidden;
                        background: #45484b;
                    }
                    body {
                        min-height: 0;
                        padding: 0;
                        color: #202124;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
                    }
                    .preview-toolbar {
                        z-index: 2000;
                        height: var(--toolbar-height);
                    }
                    #source-content { display: none !important; }
                    .preview-workspace {
                        position: fixed;
                        top: var(--toolbar-height);
                        right: 0;
                        bottom: 0;
                        left: 0;
                        display: grid;
                        grid-template-columns: minmax(0, 1fr) 0;
                        min-width: 0;
                        min-height: 0;
                        overflow: hidden;
                        background: #45484b;
                    }
                    /* 题目工具栏已嵌入 preview-toolbar 内部，无需额外偏移 */
                    body.editor-open .preview-workspace {
                        grid-template-columns: minmax(0, 1fr) var(--editor-panel-width);
                    }
                    .page-viewport {
                        position: relative;
                        min-width: 0;
                        min-height: 0;
                        overflow: auto;
                        overscroll-behavior: contain;
                        scrollbar-gutter: stable;
                        background: #45484b;
                    }
                    .page-viewport:focus-visible { outline: 2px solid #69b1ff; outline-offset: -2px; }
                    .preview-workspace .paper-container,
                    body.editor-open .preview-workspace .paper-container {
                        display: grid;
                        min-height: 100%;
                        align-items: start;
                        justify-content: safe center;
                        gap: var(--page-gap);
                        padding: 20px 24px 40px !important;
                        overflow: visible;
                        box-sizing: border-box;
                    }
                    .paper-container.layout-single { grid-template-columns: var(--paper-display-width); }
                    .paper-container.layout-double { grid-template-columns: repeat(2, var(--paper-display-width)); }
                    .paper-shell {
                        width: var(--paper-display-width);
                        height: var(--paper-display-height);
                        position: relative;
                        overflow: visible;
                    }
                    .paper {
                        width: 210mm;
                        height: 297mm;
                        min-height: 297mm;
                        margin: 0;
                        overflow: hidden;
                        transform: scale(var(--preview-scale));
                        transform-origin: top left;
                        background: #fff;
                        box-shadow: 0 3px 12px rgba(0,0,0,0.42);
                    }
                    .paper-content {
                        overflow: hidden;
                        text-align: var(--content-align);
                    }
                    .q-wrapper {
                        position: relative;
                        padding-top: 3px !important;
                        margin-bottom: var(--question-spacing) !important;
                        outline: 0 solid transparent;
                        outline-offset: 2px;
                    }
                    .q-wrapper.is-selected {
                        outline: 0;
                        box-shadow: inset 2px 0 0 rgba(22,119,255,0.78);
                    }
                    .q-wrapper:focus-visible {
                        outline: 0;
                        box-shadow: inset 3px 0 0 #1677ff;
                    }
                    .zujuanjs-question-layout { column-gap: var(--number-gap); }
                    .zujuanjs-question-body,
                    .zujuanjs-answer-item { text-align: var(--content-align); }
                    #source-content .zujuanjs-question-body p,
                    #source-content .zujuanjs-answer-item p,
                    #paper-container .zujuanjs-question-body p,
                    #paper-container .zujuanjs-answer-item p {
                        margin-top: 0;
                        margin-bottom: var(--paragraph-spacing);
                    }
                    #source-content .zujuanjs-question-body p:last-child,
                    #source-content .zujuanjs-answer-item p:last-child,
                    #paper-container .zujuanjs-question-body p:last-child,
                    #paper-container .zujuanjs-answer-item p:last-child { margin-bottom: 0; }
                    .answer-blank {
                        display: block;
                        width: 100%;
                        margin: 0;
                        padding: 0;
                        border: 0 !important;
                        outline: 0;
                        background: transparent !important;
                        box-shadow: none !important;
                        break-inside: avoid;
                        page-break-inside: avoid;
                    }
                    .answer-blank::before,
                    .answer-blank::after { display: none !important; content: none !important; }
                    .q-toolbar { display: none !important; }

                    .editor-panel {
                        position: relative !important;
                        inset: auto !important;
                        z-index: 1500;
                        display: flex;
                        width: 100% !important;
                        min-width: 0;
                        height: 100%;
                        flex-direction: column;
                        overflow: hidden;
                        border: 0;
                        border-left: 1px solid #d8dadd;
                        background: #fff;
                        box-shadow: -4px 0 16px rgba(0,0,0,0.14);
                        box-sizing: border-box;
                        opacity: 0;
                        visibility: hidden;
                        transform: none !important;
                        transition: opacity 0.12s ease;
                    }
                    body.editor-open .editor-panel {
                        opacity: 1;
                        visibility: visible;
                        transform: none !important;
                    }
                    .editor-resize-handle {
                        position: absolute;
                        top: 0;
                        bottom: 0;
                        left: -5px;
                        z-index: 5;
                        width: 10px;
                        border: 0;
                        background: transparent;
                        cursor: col-resize;
                        touch-action: none;
                    }
                    .editor-resize-handle::after {
                        position: absolute;
                        top: 0;
                        bottom: 0;
                        left: 4px;
                        width: 2px;
                        background: transparent;
                        content: "";
                        transition: background-color 0.15s ease;
                    }
                    .editor-resize-handle:hover::after,
                    .editor-resize-handle:focus-visible::after,
                    body.editor-resizing .editor-resize-handle::after { background: #1677ff; }
                    body.editor-resizing,
                    body.editor-resizing * { cursor: col-resize !important; user-select: none !important; }
                    .editor-panel-header {
                        position: relative;
                        flex: 0 0 48px;
                        height: 48px;
                        padding: 0 12px 0 16px;
                    }
                    .editor-panel-title { display: flex; min-width: 0; align-items: center; gap: 8px; }
                    .editor-panel-title small { color: #858b91; font-size: 10px; font-weight: 500; }
                    .editor-tablist {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        flex: 0 0 40px;
                        gap: 4px;
                        padding: 5px 12px;
                        border-bottom: 1px solid #e5e7ea;
                        background: #f8f9fa;
                        box-sizing: border-box;
                    }
                    .editor-tablist .btn {
                        display: inline-flex;
                        height: 30px;
                        min-height: 30px;
                        align-items: center;
                        justify-content: center;
                        padding: 0 10px;
                        border: 1px solid transparent;
                        border-radius: 4px;
                        color: #555b61;
                        background: transparent;
                        font-size: 12px;
                        line-height: 1;
                    }
                    .editor-tablist .btn.active {
                        border-color: #cfd4da;
                        color: #202124;
                        background: #fff;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.06);
                    }
                    .editor-panel-body {
                        min-height: 0;
                        flex: 1 1 auto;
                        overflow-y: auto;
                        overscroll-behavior: contain;
                    }
                    .editor-pane[hidden] { display: none !important; }
                    .editor-section { padding: 14px 16px; }
                    .editor-section-title { margin-bottom: 10px; }
                    .editor-grid { gap: 10px; }
                    .editor-grid.three-columns { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                    .editor-panel .form-control,
                    .editor-panel .form-select { height: 32px; min-height: 32px; }
                    .editor-field-unit { position: relative; }
                    .editor-field-unit .form-control { padding-right: 30px; }
                    .editor-field-unit > span {
                        position: absolute;
                        right: 8px;
                        bottom: 8px;
                        color: #8a9096;
                        font-size: 10px;
                        line-height: 1;
                        pointer-events: none;
                    }
                    .editor-panel-footer {
                        flex: 0 0 auto;
                        padding: 10px 16px 12px;
                        border-top: 1px solid #e5e7ea;
                        background: #fff;
                    }

                    /* ===== 5.9: 统一栅格、常用预设与自动保存状态 ===== */
                    .editor-panel {
                        border-left-color: #d6d9dd;
                        background: #f5f6f7;
                        box-shadow: -8px 0 24px rgba(0,0,0,0.13);
                    }
                    .editor-panel-header {
                        flex-basis: 52px;
                        height: 52px;
                        padding: 0 14px 0 16px;
                        border-bottom: 1px solid #dfe2e5;
                        background: #fff;
                    }
                    .editor-panel-title { gap: 7px; }
                    .editor-panel-title > span { color: #202428; font-size: 14px; font-weight: 650; }
                    .editor-save-status {
                        display: inline-flex;
                        align-items: center;
                        height: 20px;
                        padding: 0 6px;
                        border: 1px solid #dce7de;
                        border-radius: 3px;
                        color: #397447;
                        background: #f4faf4;
                        font-size: 10px;
                        font-weight: 500;
                        line-height: 1;
                        white-space: nowrap;
                    }
                    .editor-tablist {
                        flex-basis: 44px;
                        height: 44px;
                        gap: 5px;
                        padding: 6px 12px;
                        border-bottom-color: #dfe2e5;
                        background: #f5f6f7;
                    }
                    .editor-tablist .btn {
                        height: 32px;
                        min-height: 32px;
                        border-radius: 4px;
                        font-weight: 550;
                    }
                    .editor-panel-body { background: #fff; }
                    .editor-section {
                        padding: 16px;
                        border-bottom: 1px solid #e7e9eb;
                        background: #fff;
                    }
                    .editor-section-title {
                        display: flex;
                        align-items: center;
                        min-height: 16px;
                        margin: 0 0 12px;
                        color: #30353a;
                        font-size: 12px;
                        font-weight: 650;
                    }
                    .editor-section-note {
                        margin: -6px 0 12px;
                        color: #80868d;
                        font-size: 11px;
                        line-height: 1.45;
                    }
                    .editor-grid {
                        grid-auto-rows: min-content;
                        gap: 12px 10px;
                    }
                    .editor-field {
                        grid-template-rows: 15px 32px;
                        align-content: start;
                        gap: 5px;
                        color: #686f76;
                        font-size: 11px;
                        line-height: 15px;
                    }
                    .editor-margin-grid {
                        grid-template-columns: repeat(4, minmax(0, 1fr));
                        gap: 8px;
                    }
                    .editor-margin-grid .editor-field {
                        grid-template-rows: 15px 32px;
                        gap: 5px;
                        color: #686f76;
                        font-size: 11px;
                        line-height: 15px;
                        text-align: center;
                    }
                    .editor-margin-grid .form-control { min-width: 0; padding: 0 3px; text-align: center; }
                    .editor-panel .form-control,
                    .editor-panel .form-select {
                        height: 32px;
                        min-height: 32px;
                        border-color: #d1d5d9;
                        border-radius: 4px;
                        color: #252a2f;
                        background-color: #fff;
                    }
                    .editor-panel .form-control:hover,
                    .editor-panel .form-select:hover { border-color: #aeb5bb; }
                    .editor-check {
                        min-height: 32px;
                        margin-top: 20px;
                        padding: 0 9px;
                        border: 1px solid #d1d5d9;
                        border-radius: 4px;
                        background: #fff;
                    }
                    .editor-check.wide { margin-top: 0; }
                    .editor-check:has(.form-check-input:checked) { border-color: #91caff; background: #f0f7ff; }
                    .editor-presets {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 8px;
                    }
                    .editor-preset {
                        display: grid;
                        grid-template-columns: minmax(0, 1fr);
                        grid-template-rows: 18px 15px;
                        min-width: 0;
                        min-height: 52px;
                        padding: 8px 9px;
                        border: 1px solid #d4d8dc;
                        border-radius: 4px;
                        color: #343a40;
                        background: #fff;
                        text-align: left;
                        cursor: pointer;
                    }
                    .editor-preset:hover,
                    .editor-preset:focus-visible { border-color: #69aaf5; background: #f4f9ff; outline: 0; }
                    .editor-preset.is-active {
                        border-color: #1677ff;
                        color: #0f5ebc;
                        background: #eef6ff;
                        box-shadow: inset 3px 0 0 #1677ff;
                    }
                    .editor-preset strong,
                    .editor-preset small {
                        display: block;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .editor-preset strong { font-size: 12px; font-weight: 600; line-height: 18px; }
                    .editor-preset small { color: #7a828a; font-size: 10px; line-height: 15px; }
                    .editor-preset.is-active small { color: #4b7fbd; }
                    .editor-panel-footer {
                        padding: 12px 16px;
                        border-top-color: #dfe2e5;
                        background: #f5f6f7;
                    }
                    .editor-panel .editor-reset {
                        height: 34px;
                        min-height: 34px;
                        border-color: #bfc5cb;
                        border-radius: 4px;
                        color: #30363c;
                        background: #fff;
                        font-weight: 550;
                    }
                    @media screen and (max-width: 680px) {
                        .editor-panel-header { flex-basis: 50px; height: 50px; }
                        .editor-section { padding: 14px 16px; }
                    }

                    /* ===== 6.0: 连续工作台层次、公式字号比例与中英微间距 ===== */
                    :root {
                        --ui-workspace: #e7edeb;
                        --ui-toolbar: #183332;
                        --ui-toolbar-raised: #244442;
                        --ui-panel: #fbfcfb;
                        --ui-panel-subtle: #f2f6f4;
                        --ui-border: #d8e2de;
                        --ui-text: #24312f;
                        --ui-muted: #6c7a76;
                        --ui-accent: #08756d;
                        --ui-accent-soft: #e2f3ee;
                        --ui-primary: #2f67d8;
                    }
                    html, body,
                    .preview-workspace,
                    .page-viewport { background: var(--ui-workspace); }
                    .preview-toolbar {
                        border-bottom: 1px solid rgba(255,255,255,0.12);
                        background: var(--ui-toolbar);
                        box-shadow: 0 2px 12px rgba(17,41,39,0.20);
                    }
                    .preview-toolbar .btn-group {
                        border-color: rgba(229,245,241,0.22);
                        background: var(--ui-toolbar-raised);
                    }
                    .preview-toolbar .btn-outline-light {
                        border-color: rgba(229,245,241,0.15);
                        color: #d9e8e4;
                        background: var(--ui-toolbar-raised);
                    }
                    .preview-toolbar .btn-outline-light:hover,
                    .preview-toolbar .btn-outline-light:focus-visible {
                        border-color: rgba(229,245,241,0.42);
                        color: #fff;
                        background: #315552;
                    }
                    .preview-toolbar .btn-outline-light.active,
                    .preview-toolbar .btn-outline-light[aria-pressed="true"] {
                        border-color: #cce9e2;
                        color: #075e58;
                        background: #e4f4ef;
                        box-shadow: none;
                    }
                    .preview-toolbar .btn-primary {
                        border-color: var(--ui-primary);
                        background: var(--ui-primary);
                    }
                    .preview-toolbar .btn-primary:hover,
                    .preview-toolbar .btn-primary:focus-visible { border-color: #2558c0; background: #2558c0; }
                    .preview-page-count { color: #b8cbc5; }
                    .paper { box-shadow: 0 10px 26px rgba(25,48,44,0.19), 0 1px 3px rgba(25,48,44,0.14); }
                    .paper-content { color: #1c2423; }
                    .zh-latin-gap {
                        display: inline-block;
                        width: 0.16em;
                        min-width: 0.16em;
                        vertical-align: baseline;
                    }
                    #source-content .zujuanjs-formula-svg,
                    #paper-container .zujuanjs-formula-svg {
                        display: inline-block;
                        max-width: 100%;
                        vertical-align: -0.16em;
                        object-fit: contain;
                    }
                    .editor-panel {
                        border-left-color: var(--ui-border);
                        background: var(--ui-panel);
                        box-shadow: -10px 0 28px rgba(26,50,46,0.12);
                    }
                    .editor-panel-header,
                    .editor-panel-body,
                    .editor-section { background: var(--ui-panel); }
                    .editor-panel-header,
                    .editor-tablist,
                    .editor-panel-footer { border-color: var(--ui-border); }
                    .editor-panel-title > span,
                    .editor-section-title { color: var(--ui-text); }
                    .editor-tablist,
                    .editor-panel-footer { background: var(--ui-panel-subtle); }
                    .editor-tablist .btn { color: var(--ui-muted); }
                    .editor-tablist .btn.active {
                        border-color: #c7ddd6;
                        color: #086b64;
                        background: #fff;
                        box-shadow: 0 1px 2px rgba(24,51,48,0.06);
                    }
                    .editor-section { border-bottom-color: #e4ebe8; }
                    .editor-section-note,
                    .editor-field { color: var(--ui-muted); }
                    .base-lines-grid .bl-label,
                    .base-lines-grid .bl-input-wrap span { color: var(--ui-muted); }
                    .editor-panel .form-control,
                    .editor-panel .form-select,
                    .editor-check,
                    .editor-preset,
                    .editor-panel .editor-reset {
                        border-color: #d4dfdb;
                        color: var(--ui-text);
                        background: #fff;
                    }
                    .editor-panel .form-control:hover,
                    .editor-panel .form-select:hover,
                    .editor-check:hover,
                    .editor-preset:hover { border-color: #a9c6bd; }
                    .editor-panel .form-control:focus,
                    .editor-panel .form-select:focus {
                        border-color: var(--ui-accent);
                        box-shadow: 0 0 0 2px rgba(8,117,109,0.14);
                    }
                    .editor-check:has(.form-check-input:checked) {
                        border-color: #8ccdc0;
                        background: var(--ui-accent-soft);
                    }
                    .editor-preset:hover,
                    .editor-preset:focus-visible { border-color: #77b9ad; background: #f3faf7; }
                    .editor-preset.is-active {
                        border-color: var(--ui-accent);
                        color: #075e58;
                        background: var(--ui-accent-soft);
                        box-shadow: inset 3px 0 0 var(--ui-accent);
                    }
                    .editor-preset.is-active small { color: #3f7f74; }
                    .editor-save-status {
                        border-color: #c8e3da;
                        color: #176857;
                        background: #ecf8f3;
                    }
                    .editor-panel .editor-reset:hover,
                    .editor-panel .editor-reset:focus-visible { border-color: #93bbb0; background: #f4faf7; }
                    /* 浅色主题：题目工具栏按钮已复用 .btn-outline-light，自动跟随左侧主题；此处仅保留危险按钮与计数框 */
                    .question-float-toolbar .btn-outline-danger { color: #ff9b9b; border-color: rgba(217,54,62,0.5); }
                    .question-float-toolbar .btn-outline-danger:hover,
                    .question-float-toolbar .btn-outline-danger:focus-visible { color: #fff; border-color: #d9363e; background: #d9363e; }
                    .question-line-count {
                        border-color: var(--ui-border, #d4dfdb);
                        color: var(--ui-text);
                        background: transparent;
                    }

                    .question-float-toolbar {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        padding: 0 4px;
                        min-height: var(--toolbar-height);
                        height: 100%;
                        overflow-x: auto;
                        scrollbar-width: none;
                        border-radius: 0;
                        border: none;
                        background: transparent;
                        box-shadow: none;
                        opacity: 0;
                        visibility: hidden;
                        pointer-events: none;
                        transition: opacity 0.12s ease;
                    }
                    .question-float-toolbar::-webkit-scrollbar { display: none; }
                    .question-float-toolbar.is-visible {
                        opacity: 1;
                        visibility: visible;
                        pointer-events: auto;
                    }
                    /* 题目工具栏容器：未激活时隐藏整个中间区域 */
                    #question-toolbar-section:not(:has(.is-visible)) {
                        display: none;
                    }
                    .question-toolbar-label {
                        overflow: hidden;
                        color: #d6d9dc;
                        font-size: 12px;
                        font-weight: 600;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                        max-width: 80px;
                    }
                    .question-float-toolbar .btn-group { flex: 0 0 auto; }
                    /* 常规按钮直接复用左侧 .btn-outline-light：同款描边/底色/字体色/hover/按下阴影，零重复 */
                    .question-float-toolbar .btn:focus-visible { outline: 2px solid #69b1ff; outline-offset: 1px; }
                    /* 清除按钮保留危险语义，但视觉语言与工具栏一致 */
                    .question-float-toolbar .btn-outline-danger {
                        color: #ff9b9b;
                        border-color: #6e3a3c;
                        background: transparent;
                    }
                    .question-float-toolbar .btn-outline-danger:hover,
                    .question-float-toolbar .btn-outline-danger:focus-visible {
                        color: #fff;
                        border-color: #d9363e;
                        background: #d9363e;
                    }
                    .question-float-toolbar .btn-outline-danger > span[aria-hidden="true"] { display: none; }
                    .question-toolbar-short-label { display: none; }
                    .question-line-count {
                        display: inline-flex;
                        width: 48px;
                        height: 34px;
                        align-items: center;
                        justify-content: center;
                        border-top: 1px solid #45484b;
                        border-bottom: 1px solid #45484b;
                        color: #d6d9dc;
                        background: transparent;
                        font-size: 12px;
                        font-variant-numeric: tabular-nums;
                        white-space: nowrap;
                    }

                    @media screen and (max-width: 680px) {
                        .preview-workspace,
                        body.editor-open .preview-workspace { display: block; }
                        .page-viewport { position: absolute; inset: 0; }
                        .preview-workspace .paper-container,
                        body.editor-open .preview-workspace .paper-container {
                            gap: 12px;
                            padding: 12px 12px 32px !important;
                        }
                        .paper-container.layout-double { grid-template-columns: var(--paper-display-width); }
                        .editor-panel {
                            position: fixed !important;
                            top: auto !important;
                            right: 0 !important;
                            bottom: 0 !important;
                            left: 0 !important;
                            width: 100% !important;
                            height: min(72dvh, 620px);
                            max-height: none;
                            border-top: 1px solid #d8dadd;
                            border-left: 0;
                            opacity: 1;
                            visibility: visible;
                            transform: translateY(105%) !important;
                            transition: transform 0.18s ease !important;
                        }
                        body.editor-open .editor-panel { transform: translateY(0) !important; }
                        body:not(.editor-open) .editor-panel { visibility: hidden; }
                        .editor-resize-handle { display: none; }
                        body.editor-open .preview-workspace .paper-container {
                            padding-right: 12px !important;
                            padding-bottom: calc(min(72dvh, 620px) + 24px) !important;
                        }
                        .question-float-toolbar {
                            min-height: 52px;
                            padding: 0 4px;
                            gap: 4px;
                        }
                        .question-float-toolbar .btn { height: 40px; min-height: 40px; padding: 0 10px; font-weight: 500; }
                        .question-line-count { height: 40px; }
                        .question-toolbar-label { display: none; }
                        body.editor-open .question-float-toolbar { display: none !important; }
                    }
                    @media screen and (max-width: 390px) {
                        .question-float-toolbar .btn { width: 40px; min-width: 40px; padding: 0; }
                        .question-line-count { width: 42px; }
                        .question-toolbar-wide-label { display: none; }
                        .question-toolbar-short-label { display: inline; }
                        .question-float-toolbar .btn-outline-danger > span[aria-hidden="true"] { display: inline; }
                    }
                    @media screen and (max-width: 340px) {
                        .question-float-toolbar [data-question-action="add-lines"] { display: none; }
                    }
                    @media print {
                        html, body {
                            width: 210mm !important;
                            height: auto !important;
                            overflow: visible !important;
                            background: #fff !important;
                        }
                        .preview-toolbar,
                        .editor-panel,
                        .question-float-toolbar { display: none !important; }
                        .preview-workspace {
                            position: static !important;
                            display: block !important;
                            overflow: visible !important;
                            background: #fff !important;
                        }
                        .page-viewport { position: static !important; overflow: visible !important; }
                        .preview-workspace .paper-container,
                        body.editor-open .preview-workspace .paper-container {
                            display: block !important;
                            min-height: 0 !important;
                            padding: 0 !important;
                            overflow: visible !important;
                        }
                        .paper-shell {
                            width: 210mm !important;
                            height: 297mm !important;
                            margin: 0 !important;
                            break-after: page;
                            page-break-after: always;
                        }
                        .paper-shell:last-child { break-after: auto; page-break-after: auto; }
                        .paper { transform: none !important; box-shadow: none !important; }
                        .q-wrapper { outline: 0 !important; }
                    }
                </style>
            </head>
            <body>
                <div class="preview-toolbar" role="toolbar" aria-label="预览工具栏">
                    <div class="toolbar-section">
                        <div class="toolbar-segment btn-group btn-group-sm" role="group" aria-label="预览排布">
                            <button type="button" class="btn btn-outline-light" data-layout="single" title="单页预览" aria-label="单页预览"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h7A1.5 1.5 0 0 1 13 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 14.5v-13ZM4.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-7Z"/></svg><span class="layout-label">单页</span></button>
                            <button type="button" class="btn btn-outline-light" data-layout="double" title="双页并排" aria-label="双页并排"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h4A1.5 1.5 0 0 1 8 2.5v11A1.5 1.5 0 0 1 6.5 15h-4A1.5 1.5 0 0 1 1 13.5v-11ZM2.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-4ZM8 2.5A1.5 1.5 0 0 1 9.5 1h4A1.5 1.5 0 0 1 15 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 8 13.5v-11ZM9.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-4Z"/></svg><span class="layout-label">双页</span></button>
                        </div>
                        <div class="zoom-control btn-group btn-group-sm" role="group" aria-label="预览缩放">
                            <button type="button" class="btn btn-outline-light" data-zoom="out" title="缩小" aria-label="缩小">−</button>
                            <button type="button" class="btn btn-outline-light zoom-value" id="zoom-value" data-zoom="auto" title="自动适应">自动</button>
                            <button type="button" class="btn btn-outline-light" data-zoom="in" title="放大" aria-label="放大">+</button>
                        </div>
                        <button type="button" class="btn btn-outline-light" id="site-detail-btn" title="从单题页获取答案与考点" aria-label="获取答案与考点" style="display:none;">获取答案/考点</button>
                        <span class="preview-page-count" id="preview-page-count" aria-live="polite" aria-atomic="true">排版中…</span>
                    </div>
                    <div class="toolbar-section" id="question-toolbar-section">
                        <div class="question-float-toolbar" id="question-float-toolbar" role="toolbar" aria-label="当前题目排版工具" aria-hidden="true" data-active-block-id="">
                            <span class="question-toolbar-label" id="question-toolbar-label">当前题目</span>
                            <div class="btn-group btn-group-sm" role="group" aria-label="答题行数">
                                <button type="button" class="btn btn-outline-light" data-question-action="remove-line" title="减少一行答题空间" aria-label="减少一行答题空间">−</button>
                                <span class="question-line-count" id="question-line-count" aria-live="polite">0 行</span>
                                <button type="button" class="btn btn-outline-light" data-question-action="add-line" title="增加一行答题空间" aria-label="增加一行答题空间">+</button>
                            </div>
                            <button type="button" class="btn btn-outline-light" data-question-action="add-lines" title="增加四行答题空间">+4行</button>
                            <div class="btn-group btn-group-sm" role="group" aria-label="手动分页">
                                <button type="button" class="btn btn-outline-light" data-question-action="break-before" aria-label="在本题前分页" aria-pressed="false"><span class="question-toolbar-wide-label">前分页</span><span class="question-toolbar-short-label" aria-hidden="true">前</span></button>
                                <button type="button" class="btn btn-outline-light" data-question-action="break-after" aria-label="在本题后分页" aria-pressed="false"><span class="question-toolbar-wide-label">后分页</span><span class="question-toolbar-short-label" aria-hidden="true">后</span></button>
                            </div>
                            <button type="button" class="btn btn-outline-danger" data-question-action="clear" title="清除本题留白和分页"><span class="question-toolbar-wide-label">清除</span><span aria-hidden="true">×</span></button>
                        </div>
                    </div>
                    <div class="toolbar-section">
                        <button type="button" class="btn btn-outline-light btn-sm editor-toggle" id="editor-toggle" title="排版工具" aria-label="排版工具" aria-controls="editor-panel" aria-expanded="false"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.47 1.47 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.47 1.47 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.47 1.47 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.47 1.47 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.47 1.47 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.47 1.47 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.47 1.47 0 0 1-2.105-.872l-.1-.34ZM8 10.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg></button>
                        <button type="button" class="btn btn-primary btn-sm print-action" onclick="window.print()" title="打印"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1a2 2 0 0 0-2 2v2h2V3h6v2h2V3a2 2 0 0 0-2-2H5Zm-1 9h8v5H4v-5Zm1 1v3h6v-3H5ZM2 5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1V9h10v4h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H2Zm11 2.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z"/></svg><span class="print-action-label">打印</span></button>
                        <button type="button" class="btn btn-outline-light btn-sm close" title="关闭预览" aria-label="关闭预览" onclick="window.parent.postMessage({type: 'closeZujuanPreview', token: PREVIEW_TOKEN}, '*')"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.146 4.146a.5.5 0 0 1 .708 0L8 7.293l3.146-3.147a.5.5 0 0 1 .708.708L8.707 8l3.147 3.146a.5.5 0 0 1-.708.708L8 8.707l-3.146 3.147a.5.5 0 0 1-.708-.708L7.293 8 4.146 4.854a.5.5 0 0 1 0-.708Z"/></svg></button>
                    </div>
                </div>
                <div id="source-content" style="font-family: ${font}; font-size: ${size}; line-height: ${lineHeight};">${contentHtml}</div>
                <div class="preview-workspace" id="preview-workspace">
                    <main class="page-viewport" id="page-viewport" tabindex="0" aria-label="试卷页面预览">
                        <div class="paper-container" id="paper-container" data-render-version="0"></div>
                    </main>
                    <aside class="editor-panel" id="editor-panel" aria-label="排版工具" aria-hidden="true">
                        <div class="editor-resize-handle" id="editor-resize-handle" role="separator" tabindex="0" aria-label="调整排版工具宽度" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="520" aria-valuenow="${Math.round(editorPanelWidth)}"></div>
                        <div class="editor-panel-header">
                            <div class="editor-panel-title"><span>排版工具</span><small class="editor-save-status" id="editor-save-status" aria-live="polite">已自动保存</small></div>
                        </div>
                        <div class="editor-tablist" role="tablist" aria-label="排版类别">
                            <button type="button" class="btn" id="editor-tab-document" role="tab" data-editor-tab="document" aria-controls="editor-pane-document">文档</button>
                            <button type="button" class="btn" id="editor-tab-page" role="tab" data-editor-tab="page" aria-controls="editor-pane-page">页面</button>
                        </div>
                        <div class="editor-panel-body">
                            <div class="editor-pane" id="editor-pane-document" role="tabpanel" aria-labelledby="editor-tab-document">
                                <section class="editor-section">
                                    <div class="editor-section-title">内容</div>
                                    <div class="editor-grid">
                                        <label class="editor-field wide">打印内容
                                            <div style="display:flex;flex-wrap:nowrap;align-items:center;gap:6px 12px;padding:8px 0;">
                                                ${contentCheckboxesHtml}
                                                ${siteHasAnswers ? `<span style="width:1px;height:14px;background:#ddd;margin:0 2px;"></span>
                                                <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:#434343;"><input type="checkbox" id="setting-answers-at-end" style="accent-color:#1677ff;width:14px;height:14px;">答案附末尾</label>` : ''}
                                            </div>
                                            <div style="display:flex;flex-wrap:nowrap;align-items:center;gap:6px 12px;padding:12px 0 0;border-top:1px solid #f0f0f0;">
                                                <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:#888;"><input type="checkbox" id="setting-auto-checkin" style="accent-color:#1677ff;width:14px;height:14px;">自动签到</label>
                                                <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:#888;"><input type="checkbox" id="setting-self-check" style="accent-color:#1677ff;width:14px;height:14px;">自检模式</label>
                                            </div>
                                        </label>
                                        <label class="editor-field wide">试卷标题<input class="form-control form-control-sm" id="setting-title" type="text"></label>
                                        <label class="editor-field">标题字号<select class="form-select form-select-sm" id="setting-title-size"><option value="20px">20px</option><option value="24px">24px</option><option value="28px">28px</option><option value="32px">32px</option></select></label>
                                        <label class="editor-field editor-field-unit">题间距<input class="form-control form-control-sm" id="setting-spacing" type="number" min="0" max="32" step="1"><span>px</span></label>
                                    </div>
                                </section>
                                <section class="editor-section">
                                    <div class="editor-section-title">正文</div>
                                    <div class="editor-grid">
                                        <label class="editor-field wide">字体<select class="form-select form-select-sm" id="setting-font">${buildSelectOptions(FONT_OPTIONS)}</select></label>
                                        <label class="editor-field">字号<select class="form-select form-select-sm" id="setting-size">${buildSelectOptions(SIZE_OPTIONS)}</select></label>
                                        <label class="editor-field">行距<select class="form-select form-select-sm" id="setting-line-height">${buildSelectOptions(LINE_HEIGHT_OPTIONS)}</select></label>
                                        <label class="editor-field">对齐<select class="form-select form-select-sm" id="setting-align"><option value="left">左对齐</option><option value="justify">两端对齐</option></select></label>
                                        <label class="editor-field editor-field-unit">题号间距<input class="form-control form-control-sm" id="setting-number-gap" type="number" min="0.2" max="2" step="0.05"><span>em</span></label>
                                    </div>
                                </section>
                                <section class="editor-section">
                                    <div class="editor-section-title">默认答题行数</div>
                                    <div class="editor-grid">
                                        <div class="base-lines-grid wide">
                                            <div class="bl-label">单选题/多选题</div>
                                            <div class="bl-stepper">
                                                <button type="button" class="bl-stepper-btn" data-step="-1" data-target="setting-base-lines-objective">−</button>
                                                <div class="bl-stepper-input-wrap editor-field-unit"><input class="form-control form-control-sm" id="setting-base-lines-objective" type="number" min="0" max="24" step="1"><span>行</span></div>
                                                <button type="button" class="bl-stepper-btn" data-step="1" data-target="setting-base-lines-objective">+</button>
                                            </div>
                                            <div class="bl-label">判断题</div>
                                            <div class="bl-stepper">
                                                <button type="button" class="bl-stepper-btn" data-step="-1" data-target="setting-base-lines-judge">−</button>
                                                <div class="bl-stepper-input-wrap editor-field-unit"><input class="form-control form-control-sm" id="setting-base-lines-judge" type="number" min="0" max="24" step="1"><span>行</span></div>
                                                <button type="button" class="bl-stepper-btn" data-step="1" data-target="setting-base-lines-judge">+</button>
                                            </div>
                                            <div class="bl-label">概念填空</div>
                                            <div class="bl-stepper">
                                                <button type="button" class="bl-stepper-btn" data-step="-1" data-target="setting-base-lines-conceptFill">−</button>
                                                <div class="bl-stepper-input-wrap editor-field-unit"><input class="form-control form-control-sm" id="setting-base-lines-conceptFill" type="number" min="0" max="24" step="1"><span>行</span></div>
                                                <button type="button" class="bl-stepper-btn" data-step="1" data-target="setting-base-lines-conceptFill">+</button>
                                            </div>
                                            <div class="bl-label">填空题</div>
                                            <div class="bl-stepper">
                                                <button type="button" class="bl-stepper-btn" data-step="-1" data-target="setting-base-lines-fill">−</button>
                                                <div class="bl-stepper-input-wrap editor-field-unit"><input class="form-control form-control-sm" id="setting-base-lines-fill" type="number" min="0" max="24" step="1"><span>行</span></div>
                                                <button type="button" class="bl-stepper-btn" data-step="1" data-target="setting-base-lines-fill">+</button>
                                            </div>
                                            <div class="bl-label">解答题</div>
                                            <div class="bl-stepper">
                                                <button type="button" class="bl-stepper-btn" data-step="-1" data-target="setting-base-lines-solution">−</button>
                                                <div class="bl-stepper-input-wrap editor-field-unit"><input class="form-control form-control-sm" id="setting-base-lines-solution" type="number" min="0" max="24" step="1"><span>行</span></div>
                                                <button type="button" class="bl-stepper-btn" data-step="1" data-target="setting-base-lines-solution">+</button>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                            <div class="editor-pane" id="editor-pane-page" role="tabpanel" aria-labelledby="editor-tab-page" hidden>
                                <section class="editor-section">
                                    <div class="editor-section-title">常用版式</div>
                                    <div class="editor-section-note" id="layout-preset-note">选择预设后仍可继续微调，所有改动会自动记住。</div>
                                    <div class="editor-presets" role="group" aria-label="常用版式预设">
                                        <button type="button" class="editor-preset" data-layout-preset="exam"><strong>考试标准</strong><small>题目排版默认</small></button>
                                        <button type="button" class="editor-preset" data-layout-preset="word-normal"><strong>Word 普通</strong><small>上下左右 25.4 mm</small></button>
                                        <button type="button" class="editor-preset" data-layout-preset="word-narrow"><strong>Word 窄</strong><small>上下左右 12.7 mm</small></button>
                                        <button type="button" class="editor-preset" data-layout-preset="word-moderate"><strong>Word 适中</strong><small>上下 25.4，左右 19.1 mm</small></button>
                                        <button type="button" class="editor-preset" data-layout-preset="compact"><strong>紧凑省纸</strong><small>更少留白与间距</small></button>
                                        <button type="button" class="editor-preset" data-layout-preset="word-wide"><strong>Word 宽</strong><small>上下 25.4，左右 50.8 mm</small></button>
                                    </div>
                                </section>
                                <section class="editor-section">
                                    <div class="editor-section-title">页边距</div>
                                    <div class="editor-margin-grid">
                                        <label class="editor-field">上 mm<input class="form-control form-control-sm" id="setting-margin-top" type="number" min="8" max="55" step="0.1"></label>
                                        <label class="editor-field">右 mm<input class="form-control form-control-sm" id="setting-margin-right" type="number" min="8" max="55" step="0.1"></label>
                                        <label class="editor-field">下 mm<input class="form-control form-control-sm" id="setting-margin-bottom" type="number" min="8" max="55" step="0.1"></label>
                                        <label class="editor-field">左 mm<input class="form-control form-control-sm" id="setting-margin-left" type="number" min="8" max="55" step="0.1"></label>
                                    </div>
                                </section>
                                <section class="editor-section">
                                    <div class="editor-section-title">页面显示</div>
                                    <div class="editor-grid">
                                        <div class="base-lines-grid wide">
                                            <div class="bl-label">页面间距</div>
                                            <div class="bl-stepper">
                                                <button type="button" class="bl-stepper-btn" data-step="-1" data-target="setting-page-gap">−</button>
                                                <div class="bl-stepper-input-wrap editor-field-unit"><input class="form-control form-control-sm" id="setting-page-gap" type="number" min="8" max="48" step="1"><span>px</span></div>
                                                <button type="button" class="bl-stepper-btn" data-step="1" data-target="setting-page-gap">+</button>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                                <section class="editor-section">
                                    <div class="editor-section-title">页码</div>
                                    <div class="editor-grid">
                                        <label class="editor-check wide"><input class="form-check-input" id="setting-page-number" type="checkbox">显示页码</label>
                                        <label class="editor-field wide">字体<select class="form-select form-select-sm" id="setting-page-font">${buildSelectOptions(FONT_OPTIONS)}</select></label>
                                        <label class="editor-field">字号<select class="form-select form-select-sm" id="setting-page-size">${buildSelectOptions(PAGE_SIZE_OPTIONS)}</select></label>
                                        <label class="editor-check"><input class="form-check-input" id="setting-page-bold" type="checkbox">加粗</label>
                                    </div>
                                </section>
                            </div>
                        </div>
                        <div class="editor-panel-footer">
                            <button type="button" class="editor-reset btn btn-outline-secondary btn-sm w-100" id="editor-reset">恢复默认</button>
                        </div>
                    </aside>
                </div>
                <script>
                    const PREVIEW_TOKEN = ${JSON.stringify(PREVIEW_TOKEN)};
                    const A4 = { w: 210, h: 297 };
                    const DEBUG_FORMULA = ${debugFormula};
                    // 分页循环上限：与父窗口 MAX_PAGINATE_ITER 同源（iframe 为沙箱隔离作用域，无法访问父级常量）
                    const MAX_PAGINATE_ITER = ${MAX_PAGINATE_ITER};
                    const sourceContent = document.getElementById('source-content');
                    const paperContainer = document.getElementById('paper-container');
                    const pageViewport = document.getElementById('page-viewport');
                    const paperWidthPx = A4.w * (96 / 25.4);
                    const paperHeightPx = A4.h * (96 / 25.4);
                    const zoomSteps = [0.25, 0.33, 0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
                    const overflowTolerance = 0.75;
                    const previewSettings = ${previewSettingsJson};
                    const editorPanel = document.getElementById('editor-panel');
                    const editorToggle = document.getElementById('editor-toggle');
                    const editorResizeHandle = document.getElementById('editor-resize-handle');
                    const questionToolbar = document.getElementById('question-float-toolbar');
                    const editorSaveStatus = document.getElementById('editor-save-status');
                    const layoutPresetNote = document.getElementById('layout-preset-note');
                    // 版式预设与 schema 均来自父窗口注入的单一来源，与脚本定义保持一致
                    const layoutPresets = previewSettings.layoutPresets;
                    const settingSchema = previewSettings.schema;
                    let currentLayout = previewSettings.previewLayout;
                    let currentZoom = previewSettings.previewZoom;
                    let currentScale = 1;
                    let currentPanelWidth = clamp(previewSettings.editorPanelWidth, 280, 520, 340);
                    let currentEditorTab = previewSettings.editorPanelTab === 'page' ? 'page' : 'document';
                    let editorOpen = window.innerWidth > 900 && previewSettings.editorOpen !== false;
                    let activeBlockId = previewSettings.readingAnchor?.blockId || '';
                    let pendingReadingAnchor = previewSettings.readingAnchor || null;
                    const blockEdits = normalizeBlockEdits(previewSettings.documentEdits);
                    let renderFrame = 0;
                    let toolbarPositionFrame = 0;
                    let editorApplyTimer = 0;
                    let settingsSaveTimer = 0;
                    let zoomPreferenceTimer = 0;
                    let isRendering = false;
                    let renderAgain = false;
                    let renderVersion = 0;

                    // [调试] 公式排版诊断：父页面 URL 带 #formuladebug 时，渲染后输出分数各部分的实际尺寸。
                    function dumpFormulaDiagnostics() {
                        try {
                            const scope = document.querySelector('#paper-container') || document;
                            const fracs = Array.from(scope.querySelectorAll('.mfrac'));
                            console.log('[公式诊断] .mfrac 总数:', fracs.length);
                            // 负号分布诊断：负号忽大忽小时，用它区分「字符不一致(U+2212/U+002D 混用)」
                            // 还是「同一字符落在不同字体/字号」——按 类名+字符码+字体+字号 分组计数
                            try {
                                const minusRe = /[\u2212\u002D\uFF0D]/;
                                const groups = {};
                                Array.from(scope.querySelectorAll('.mo, .math-letter, .mtext, .mnormal')).forEach(el => {
                                    const text = (el.textContent || '').replace(/\s/g, '');
                                    if (!text || text.length > 2 || !minusRe.test(text)) return;
                                    const cs = getComputedStyle(el);
                                    const key = 'cls=' + (el.className || '')
                                        + ' chars=' + Array.from(text).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(',')
                                        + ' font=' + cs.fontFamily.split(',')[0].replace(/['"]/g, '')
                                        + ' size=' + cs.fontSize;
                                    groups[key] = (groups[key] || 0) + 1;
                                });
                                console.log('[公式诊断] 负号分布（cls/chars/font/size → 数量）:');
                                Object.keys(groups).sort().forEach(k => console.log('  ×' + groups[k], k));
                            } catch (e) { /* 忽略 */ }
                            if (!fracs.length) return;
                            // 全部分数对照表：mfrac 宽 / 分数线段落宽 / 分子容器布局宽 / 分子内容实际宽
                            const table = [];
                            const bad = [];
                            fracs.forEach((f, i) => {
                                const zi = f.querySelector('.fracZi');
                                const line = f.querySelector('.fracLine');
                                const mu = f.querySelector('.fracMu');
                                const fw = f.getBoundingClientRect().width;
                                const zw = zi ? zi.getBoundingClientRect().width : 0;
                                const lw = line ? line.getBoundingClientRect().width : 0;
                                const mw = mu ? mu.getBoundingClientRect().width : 0;
                                // 分子内容实际占宽（累加其子元素）
                                let inner = 0;
                                if (zi) {
                                    const kids = Array.from(zi.children);
                                    if (kids.length) {
                                        const first = kids[0].getBoundingClientRect();
                                        const last = kids[kids.length - 1].getBoundingClientRect();
                                        inner = last.right - first.left;
                                    }
                                }
                                const row = {
                                    序号: i,
                                    内容: (f.textContent || '').replace(/\s/g, '').slice(0, 14),
                                    mfrac宽: +fw.toFixed(2),
                                    分子容器宽: +zw.toFixed(2),
                                    分数线宽: +lw.toFixed(2),
                                    分子内容宽: +inner.toFixed(2),
                                    分母宽: +mw.toFixed(2),
                                    布局clientW: zi ? zi.clientWidth : 0,
                                    布局scrollW: zi ? zi.scrollWidth : 0,
                                };
                                table.push(row);
                                // 异常判定：分子内容明显窄于分数线（线过长），或分子溢出容器
                                if (inner > 0 && lw - inner > 2) row.问题 = '分数线比分子长';
                                if (zw > 0 && inner > zw + 1) row.问题 = (row.问题 ? row.问题 + '+' : '') + '分子溢出容器';
                                if (row.问题) bad.push(row);
                            });
                            // 挂到 window 便于控制台复制：copy(JSON.stringify(window.__zujuanFracTable))
                            try { window.__zujuanFracTable = table; } catch (e) { /* 忽略 */ }
                            try { console.table(table); } catch (e) { console.log(table); }
                            console.log('[公式诊断] 疑似异常分数:', bad.length, '/', fracs.length);
                            if (bad.length) { try { console.table(bad); } catch (e) { console.log(bad); } }
                            console.log('[公式诊断] 字体状态:', document.fonts ? document.fonts.status : 'n/a');
                            if (document.fonts && document.fonts.check) {
                                ['JyeooHai-Size1', 'JyeooHai-Main-Regular', 'JyeooHai-Math-Regular', 'JyeooHai-Math-Italic', 'JyeooHai-AMS', 'JyeooHai-Arrow'].forEach(n => {
                                    const ok = document.fonts.check('14px "' + n + '"');
                                    console.log('      · 字体可用 ' + n + ' = ' + ok);
                                });
                            }
                            // 垂直参数：box-sizing / height / padding-top / y 坐标（MathJye 的 top/height 是固定像素，需与原站一致）
                            const vinfo = (el, tag) => {
                                if (!el) return tag + ': null';
                                const cs = getComputedStyle(el);
                                const r = el.getBoundingClientRect();
                                return tag + ': box=' + cs.boxSizing + ' h=' + cs.height + ' pt=' + cs.paddingTop
                                    + ' y=' + r.top.toFixed(1) + ' rh=' + r.height.toFixed(1);
                            };
                            if (fracs.length) {
                                const f0 = fracs[fracs.length > 7 ? 7 : 0];
                                console.log('[公式诊断·垂直] ' + vinfo(f0, 'mfrac'));
                                console.log('   ' + vinfo(f0.querySelector('.fracZi'), 'fracZi')
                                    + ' | ' + vinfo(f0.querySelector('.fracLine'), 'fracLine')
                                    + ' | ' + vinfo(f0.querySelector('.fracMu'), 'fracMu'));
                                const z0 = f0.querySelector('.fracZi');
                                if (z0) Array.from(z0.children).forEach((c, i) => console.log('   子' + i + ' ' + vinfo(c, c.className.split(' ')[0])));
                            }

                            const sq = document.querySelector('#paper-container .msqrtSign .singleSqrt');
                            if (sq) {
                                const r = sq.getBoundingClientRect();
                                console.log('[公式诊断] 根号字形 w=' + r.width.toFixed(2) + ' h=' + r.height.toFixed(2)
                                    + ' font=' + getComputedStyle(sq).fontFamily + ' text=' + JSON.stringify(sq.textContent));
                                const sign = sq.parentElement;
                                console.log('[公式诊断] msqrtSign style=', sign.getAttribute('style'));
                                const box = sign.parentElement.querySelector('.msqrtBox');
                                if (box) console.log('[公式诊断] msqrtBox w=' + box.getBoundingClientRect().width.toFixed(2));
                            }
                        } catch (e) { console.warn('[公式诊断] 失败', e); }
                    }
                    if (DEBUG_FORMULA) {
                        [800, 2000, 4000].forEach(t => setTimeout(dumpFormulaDiagnostics, t));
                    }

                    function setSaveStatus(message) {
                        if (editorSaveStatus) editorSaveStatus.textContent = message;
                    }

                    function updateLayoutPresetUI() {
                        // 以用户当前选择的版式为准；'custom' 为手动微调状态，脏值/空串回退到默认 'compact'（与父窗口归一逻辑一致）
                        const requested = previewSettings.layoutPreset === 'custom'
                            ? 'custom'
                            : (layoutPresets[previewSettings.layoutPreset] ? previewSettings.layoutPreset : 'compact');
                        const preset = layoutPresets[requested];
                        const matchesPreset = preset && Object.entries(preset.settings).every(([key, value]) => String(previewSettings[key]) === String(value));
                        // 所选版式与当前各项设置仍一致→高亮该版式；已偏离→归为自定义
                        const activePreset = matchesPreset ? requested : 'custom';
                        document.querySelectorAll('[data-layout-preset]').forEach(button => {
                            const active = button.dataset.layoutPreset === activePreset;
                            button.classList.toggle('is-active', active);
                            button.setAttribute('aria-pressed', String(active));
                        });
                        if (layoutPresetNote) {
                            layoutPresetNote.textContent = activePreset === 'custom'
                                ? '当前为自定义版式，所有改动会自动记住。'
                                : '当前使用“' + layoutPresets[activePreset].label + '”，仍可继续微调并自动保存。';
                        }
                    }

                    function savePreviewPreference(key, value) {
                        window.parent.postMessage({ type: 'saveZujuanPreviewPreference', key: key, value: String(value), token: PREVIEW_TOKEN }, '*');
                    }

                    function savePrintSettings() {
                        previewSettings.documentEdits = serializeBlockEdits();
                        previewSettings.editorPanelWidth = String(currentPanelWidth);
                        previewSettings.editorPanelTab = currentEditorTab;
                        previewSettings.editorOpen = editorOpen;
                        window.parent.postMessage({ type: 'saveZujuanPrintSettings', settings: previewSettings, token: PREVIEW_TOKEN }, '*');
                        setSaveStatus('已自动保存');
                    }

                    function clamp(value, min, max, fallback) {
                        const number = Number(value);
                        return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
                    }

                    function normalizeBlockEdits(input) {
                        const normalized = {};
                        if (!input || typeof input !== 'object') return normalized;
                        Object.entries(input).forEach(([blockId, state]) => {
                            if (!state || typeof state !== 'object') return;
                            const extraLines = Math.round(clamp(state.extraLines, 0, 40, 0));
                            const breakBefore = Boolean(state.breakBefore);
                            const breakAfter = Boolean(state.breakAfter);
                            if (extraLines || breakBefore || breakAfter) {
                                normalized[blockId] = { extraLines, breakBefore, breakAfter };
                            }
                        });
                        return normalized;
                    }

                    function getBlockEdit(blockId) {
                        if (!blockEdits[blockId]) {
                            blockEdits[blockId] = { extraLines: 0, breakBefore: false, breakAfter: false };
                        }
                        return blockEdits[blockId];
                    }

                    function serializeBlockEdits() {
                        const serialized = {};
                        Object.entries(blockEdits).forEach(([blockId, state]) => {
                            const extraLines = Math.round(clamp(state.extraLines, 0, 40, 0));
                            const breakBefore = Boolean(state.breakBefore);
                            const breakAfter = Boolean(state.breakAfter);
                            if (extraLines || breakBefore || breakAfter) {
                                serialized[blockId] = { extraLines, breakBefore, breakAfter };
                            }
                        });
                        return serialized;
                    }

                    // 按题型分别设置默认答题行数：匹配各站点的固定题型名。
                    // 注意顺序：概念填空 必须先于 填空 匹配，否则"概念填空"会被 /填空/ 正则吞掉而归错类。
                    // 选择题需同时覆盖「单选题/多选题」（组卷网）与「选择题」（菁优网）。
                    function resolveQuestionType(wrapper) {
                        let prev = wrapper.previousElementSibling;
                        while (prev) {
                            if (prev.classList.contains('zujuanjs-section-title')) {
                                const text = prev.textContent || '';
                                if (/概念填空/.test(text)) return 'conceptFill';
                                if (/填空/.test(text)) return 'fill';
                                if (/单选|多选|选择/.test(text)) return 'objective';
                                if (/判断/.test(text)) return 'judge';
                                if (/解答/.test(text)) return 'solution';
                                return 'unknown';
                            }
                            prev = prev.previousElementSibling;
                        }
                        return 'unknown';
                    }

                    function applyBlockEditsToSource() {
                        Array.from(sourceContent.children)
                            .filter(element => element.classList.contains('page-break'))
                            .forEach(element => element.remove());
                        sourceContent.querySelectorAll('.q-wrapper > .answer-blank, .q-wrapper > .answer-blank-large')
                            .forEach(element => element.remove());
                        const wrappers = Array.from(sourceContent.children).filter(element => element.classList.contains('q-wrapper'));

                        let byTypeBase = previewSettings.baseAnswerLinesByType || {};
                        if (typeof byTypeBase === 'string') { try { byTypeBase = JSON.parse(byTypeBase); } catch (e) { byTypeBase = {}; } }
                        if (!byTypeBase || typeof byTypeBase !== 'object') byTypeBase = {};

                        wrappers.forEach(wrapper => {
                            const state = getBlockEdit(wrapper.dataset.blockId);
                            const isAnswerEntry = wrapper.classList.contains('zujuanjs-answer-entry')
                                || wrapper.classList.contains('zujuanjs-inline-answer');
                            const qType = isAnswerEntry ? 'answer-entry' : resolveQuestionType(wrapper);
                            // 按题型取默认行数；unknown（识别不出）或答案块不加默认行（Q3 B）。
                            const extraBase = (!isAnswerEntry && qType !== 'unknown')
                                ? Math.max(0, Math.min(24, Math.round(Number(byTypeBase[qType]) || 0)))
                                : 0;
                            const effectiveLines = state.extraLines + extraBase;
                            wrapper.dataset.extraLines = String(effectiveLines);
                            // 菁优网：题目与内联答案是相邻的两个块（question-N / answer-N）。
                            // 给题目加行时若紧邻同题答案块，空行追加到答案块末尾——
                            // 「题目+答案」按一个整体对待（与组卷网一致），否则空行会插在题目和答案之间。
                            let blankTarget = wrapper;
                            const qidMatch = /^question-(\d+)$/.exec(wrapper.dataset.blockId || '');
                            if (qidMatch && !isAnswerEntry) {
                                const next = wrapper.nextElementSibling;
                                if (next && next.classList.contains('zujuanjs-inline-answer')
                                    && next.dataset.blockId === 'answer-' + qidMatch[1]) {
                                    blankTarget = next;
                                }
                            }
                            for (let index = 0; index < effectiveLines; index++) {
                                const blank = document.createElement('div');
                                blank.className = 'answer-blank';
                                blank.dataset.lineIndex = String(index + 1);
                                blank.setAttribute('aria-hidden', 'true');
                                blankTarget.appendChild(blank);
                            }
                        });

                        wrappers.forEach(wrapper => {
                            const state = getBlockEdit(wrapper.dataset.blockId);
                            if (state.breakBefore) {
                                // 若本题紧邻章节标题（小标题），把「前分页」分隔符插到标题之前，
                                // 而非标题与题目之间：分页顺序变为「分隔符→标题→题目」，
                                // 标题与题目一起换到下一页，避免「标题留在上页、题目跑到下页」被拆开。
                                const prev = wrapper.previousElementSibling;
                                const anchor = (prev && prev.classList.contains('zujuanjs-section-title')) ? prev : wrapper;
                                if (!anchor.previousElementSibling?.classList.contains('page-break')) {
                                    const marker = document.createElement('div');
                                    marker.className = 'page-break';
                                    marker.dataset.ownerBlockId = wrapper.dataset.blockId;
                                    marker.dataset.breakSide = 'before';
                                    wrapper.parentNode.insertBefore(marker, anchor);
                                }
                            }
                            if (state.breakAfter && !wrapper.nextElementSibling?.classList.contains('page-break')) {
                                const marker = document.createElement('div');
                                marker.className = 'page-break';
                                marker.dataset.ownerBlockId = wrapper.dataset.blockId;
                                marker.dataset.breakSide = 'after';
                                wrapper.parentNode.insertBefore(marker, wrapper.nextSibling);
                            }
                        });
                        previewSettings.documentEdits = serializeBlockEdits();
                    }

                    function setSelectValue(id, value) {
                        const select = document.getElementById(id);
                        if (!select) return;
                        const matchingOption = Array.from(select.options).find(option => option.value === String(value));
                        if (matchingOption) {
                            select.value = matchingOption.value;
                            return;
                        }
                        const custom = new Option('自定义', String(value));
                        select.add(custom, 0);
                        select.value = custom.value;
                    }

                    function writeSettingsToEditor() {
                        const margins = String(previewSettings.pageMargins).split(',');
                        // 设置打印内容多选框
                        const flags = previewSettings.contentFlags || (previewSettings.mode === 'a' ? ['a'] : ['q']);
                        document.querySelectorAll('input[name="setting-content"]').forEach(cb => {
                            if (cb.dataset.locked) { cb.checked = true; cb.disabled = true; return; }
                            cb.checked = flags.includes(cb.value);
                        });
                        const atEndCb = document.getElementById('setting-answers-at-end');
                        if (atEndCb) atEndCb.checked = Boolean(previewSettings.answersAtEnd);
                        document.getElementById('setting-title').value = previewSettings.title || '';
                        setSelectValue('setting-title-size', previewSettings.titleSize);
                        document.getElementById('setting-spacing').value = previewSettings.questionSpacing;
                        setSelectValue('setting-font', previewSettings.font);
                        setSelectValue('setting-size', previewSettings.size);
                        setSelectValue('setting-line-height', previewSettings.lineHeight);
                        setSelectValue('setting-align', previewSettings.contentAlign);
                        document.getElementById('setting-number-gap').value = previewSettings.numberGap;
                        ['top', 'right', 'bottom', 'left'].forEach((side, index) => {
                            document.getElementById('setting-margin-' + side).value = margins[index] || 15;
                        });
                        // 按题型回填默认答题行数（每种题型一个输入框）
                        let byType = previewSettings.baseAnswerLinesByType || {};
                        if (typeof byType === 'string') { try { byType = JSON.parse(byType); } catch (e) { byType = {}; } }
                        if (!byType || typeof byType !== 'object') byType = {};
                        ['objective', 'judge', 'fill', 'conceptFill', 'solution'].forEach(k => {
                            const el = document.getElementById('setting-base-lines-' + k);
                            if (el) el.value = String(Number(byType[k]) || 0);
                        });
                        document.getElementById('setting-page-gap').value = previewSettings.pageGap;
                        document.getElementById('setting-page-number').checked = previewSettings.showPageNumber !== false;
                        setSelectValue('setting-page-font', previewSettings.pageFont);
                        setSelectValue('setting-page-size', previewSettings.pageSize);
                        document.getElementById('setting-page-bold').checked = Boolean(previewSettings.pageBold);
                        const autoCb = document.getElementById('setting-auto-checkin');
                        if (autoCb) autoCb.checked = Boolean(previewSettings.autoCheckIn);
                        const selfCb = document.getElementById('setting-self-check');
                        if (selfCb) selfCb.checked = Boolean(previewSettings.selfCheck);
                        updateLayoutPresetUI();
                    }

                    function readSettingsFromEditor() {
                        const margin = side => clamp(document.getElementById('setting-margin-' + side).value, 8, 55, 15);
                        const contentChecks = document.querySelectorAll('input[name="setting-content"]:checked');
                        const contentFlags = Array.from(contentChecks).map(el => el.value);
                        return {
                            contentFlags,
                            answersAtEnd: document.getElementById('setting-answers-at-end')?.checked || false,
                            title: document.getElementById('setting-title').value.trim(),
                            titleSize: document.getElementById('setting-title-size').value,
                            questionSpacing: String(clamp(document.getElementById('setting-spacing').value, 0, 32, 10)),
                            font: document.getElementById('setting-font').value,
                            size: document.getElementById('setting-size').value,
                            lineHeight: document.getElementById('setting-line-height').value,
                            paragraphSpacing: previewSettings.paragraphSpacing,
                            contentAlign: document.getElementById('setting-align').value === 'justify' ? 'justify' : 'left',
                            numberGap: String(clamp(document.getElementById('setting-number-gap').value, 0.2, 2, 0.55)),
                            pageMargins: [margin('top'), margin('right'), margin('bottom'), margin('left')].join(','),
                            layoutPreset: layoutPresets[previewSettings.layoutPreset] ? previewSettings.layoutPreset : 'custom',
                            baseAnswerLinesByType: (() => {
                                const obj = {};
                                ['objective', 'judge', 'fill', 'conceptFill', 'solution'].forEach(k => {
                                    const el = document.getElementById('setting-base-lines-' + k);
                                    obj[k] = el ? Math.max(0, Math.min(24, Math.round(Number(el.value) || 0))) : 0;
                                });
                                return obj;
                            })(),
                            pageGap: String(clamp(document.getElementById('setting-page-gap').value, 8, 48, 20)),
                            showPageNumber: document.getElementById('setting-page-number').checked,
                            pageFont: document.getElementById('setting-page-font').value,
                            pageSize: document.getElementById('setting-page-size').value,
                            pageBold: document.getElementById('setting-page-bold').checked,
                            previewLayout: currentLayout,
                            previewZoom: currentZoom,
                            editorPanelWidth: String(currentPanelWidth),
                            editorPanelTab: currentEditorTab,
                            editorOpen,
                            documentEdits: serializeBlockEdits(),
                            readingAnchor: captureReadingAnchor()
                        };
                    }

                    // 由注入的 schema 推导全部设置的默认值（与父窗口 getPreviewSettings 的 def 保持一致）。
                    // 跳过 title（动态取卷名，保留当前值）；pageFont 缺省回退 font；csv/bool 类型还原为 def。
                    function buildDefaultPreviewSettings() {
                        const defaults = {};
                        for (const s of settingSchema) {
                            if (s.type === 'title') continue;
                            if (s.type === 'pageFont') { defaults[s.key] = null; continue; }
                            if (s.type === 'csv') { defaults[s.key] = String(s.def == null ? '' : s.def).split(',').filter(Boolean); continue; }
                            if (s.type === 'boolStr') { defaults[s.key] = String(s.def) !== 'false'; continue; }
                            if (s.type === 'boolObj') { defaults[s.key] = Boolean(s.def); continue; }
                            defaults[s.key] = s.def;
                        }
                        if (defaults.pageFont == null) defaults.pageFont = defaults.font;
                        return defaults;
                    }

                    function applyLayoutPreset(name, resetAll = false) {
                        const preset = layoutPresets[name];
                        if (!preset) return;
                        // resetAll=true（"恢复默认"按钮）：先铺满 schema 默认值，再叠加预设覆盖项，
                        // 保证所有字段都回退到默认，而非只改预设定义的几项（如 compact 仅 4 项）。
                        // resetAll=false（显式预设按钮）：保持旧的部分合并行为，只改预设定义的项、保留用户其他设置。
                        const base = resetAll ? buildDefaultPreviewSettings() : {};
                        Object.assign(previewSettings, base, preset.settings, { layoutPreset: name });
                        currentLayout = previewSettings.previewLayout;
                        currentZoom = previewSettings.previewZoom;
                        writeSettingsToEditor();
                        applyDocumentStyles();
                        applyPreviewView();
                        scheduleRender();
                        // [fix] 恢复默认可能改变"打印内容"开关（试题/知识点/答案/附末尾），这些开关属于
                        // 父窗口提取源内容阶段（generateSourceContentHTML），iframe 内 scheduleRender 仅重新
                        // 分页、不会删除已生成的源内容 DOM。必须通知父窗口按最新设置重新提取源内容，否则
                        // 预览里知识点等仍残留（勾选框已取消但内容不消失）。仅 resetAll 路径需要（显式
                        // 预设按钮只改排版字段，不影响内容开关，无需重建）。
                        if (resetAll) scheduleRebuild();
                        setSaveStatus('正在保存…');
                        scheduleSettingsSave();
                    }

                    function applyFormulaScale() {
                        const ratio = clamp(Number.parseFloat(previewSettings.size) / 14, 0.65, 2.2, 1);
                        // 注：公式缩放实际依赖下方逐图 image.style.width 内联，无需 --formula-scale 变量（全局 CSS 也未引用）。
                        sourceContent.querySelectorAll('img.zujuanjs-formula-svg').forEach(image => {
                            let baseWidth = Number.parseFloat(image.dataset.formulaBaseWidth);
                            let baseHeight = Number.parseFloat(image.dataset.formulaBaseHeight);
                            if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
                                baseWidth = image.naturalWidth || 0;
                                if (baseWidth > 0) image.dataset.formulaBaseWidth = String(baseWidth);
                            }
                            if (!Number.isFinite(baseHeight) || baseHeight <= 0) {
                                baseHeight = image.naturalHeight || 0;
                                if (baseHeight > 0) image.dataset.formulaBaseHeight = String(baseHeight);
                            }
                            if (baseWidth > 0) {
                                image.style.width = (baseWidth * ratio) + 'px';
                                image.style.height = baseHeight > 0 ? (baseHeight * ratio) + 'px' : 'auto';
                            } else if (baseHeight > 0) {
                                image.style.height = (baseHeight * ratio) + 'px';
                                image.style.width = 'auto';
                            }
                        });
                    }

                    function applyDocumentStyles() {
                        const margins = String(previewSettings.pageMargins).split(',').map(value => clamp(value, 8, 55, 15));
                        const top = margins[0], right = margins[1], bottom = margins[2], left = margins[3];
                        const contentWidth = A4.w - left - right;
                        const contentHeight = A4.h - top - bottom;
                        const root = document.documentElement;
                        root.style.setProperty('--question-font', previewSettings.font);
                        root.style.setProperty('--question-size', previewSettings.size);
                        root.style.setProperty('--question-line-height', previewSettings.lineHeight);
                        root.style.setProperty('--page-font', previewSettings.pageFont);
                        root.style.setProperty('--page-size', previewSettings.pageSize);
                        root.style.setProperty('--page-weight', previewSettings.pageBold ? 'bold' : 'normal');
                        root.style.setProperty('--page-margin-top', top + 'mm');
                        root.style.setProperty('--page-margin-right', right + 'mm');
                        root.style.setProperty('--page-margin-bottom', bottom + 'mm');
                        root.style.setProperty('--page-margin-left', left + 'mm');
                        root.style.setProperty('--page-content-width', contentWidth + 'mm');
                        root.style.setProperty('--page-content-height', contentHeight + 'mm');
                        root.style.setProperty('--page-image-max-height', Math.max(20, contentHeight - 12) + 'mm');
                        root.style.setProperty('--page-footer-bottom', Math.max(5, Math.min(9, bottom / 3)) + 'mm');
                        root.style.setProperty('--question-spacing', clamp(previewSettings.questionSpacing, 0, 32, 10) + 'px');
                        root.style.setProperty('--title-size', Math.max(18, Math.min(36, parseFloat(previewSettings.titleSize) || 24)) + 'px');
                        root.style.setProperty('--paragraph-spacing', clamp(previewSettings.paragraphSpacing, 0, 24, 8) + 'px');
                        root.style.setProperty('--number-gap', clamp(previewSettings.numberGap, 0.2, 2, 0.55) + 'em');
                        root.style.setProperty('--page-gap', clamp(previewSettings.pageGap, 8, 48, 20) + 'px');
                        root.style.setProperty('--content-align', previewSettings.contentAlign === 'justify' ? 'justify' : 'left');

                        const title = sourceContent.querySelector('[data-document-title]');
                        if (title) {
                            title.textContent = previewSettings.title || '';
                            title.style.display = previewSettings.title ? '' : 'none';
                            title.style.fontFamily = previewSettings.font;
                            title.style.fontSize = Math.max(18, Math.min(36, parseFloat(previewSettings.titleSize) || 24)) + 'px';
                        }
                        // 知识点容器（.zujuanjs-knowledge-points）由脚本创建时写入了内联字体，
                        // 不随预览设置更新，这里一并同步，避免改字体/字号后知识点不跟着变。
                        sourceContent.querySelectorAll('.zujuanjs-question, .zujuanjs-answer-item, .zujuanjs-knowledge-points').forEach(element => {
                            element.style.fontFamily = previewSettings.font;
                            element.style.fontSize = previewSettings.size;
                            element.style.lineHeight = previewSettings.lineHeight;
                        });
                        sourceContent.querySelectorAll('.zujuanjs-section-title, .zujuanjs-answer-title').forEach(element => {
                            element.style.fontFamily = previewSettings.font;
                        });
                        applyFormulaScale();
                    }

                    function setEditorTab(tab, persist = true) {
                        currentEditorTab = tab === 'page' ? 'page' : 'document';
                        previewSettings.editorPanelTab = currentEditorTab;
                        document.querySelectorAll('[data-editor-tab]').forEach(button => {
                            const active = button.dataset.editorTab === currentEditorTab;
                            button.classList.toggle('active', active);
                            button.setAttribute('aria-selected', String(active));
                            button.tabIndex = active ? 0 : -1;
                        });
                        document.querySelectorAll('.editor-pane').forEach(pane => {
                            pane.hidden = pane.id !== 'editor-pane-' + currentEditorTab;
                        });
                        if (persist) savePreviewPreference('editorPanelTab', currentEditorTab);
                    }

                    function applyEditorPanelWidth(width, persist = false) {
                        currentPanelWidth = Math.round(clamp(width, 280, 520, 340));
                        previewSettings.editorPanelWidth = String(currentPanelWidth);
                        document.documentElement.style.setProperty('--editor-panel-width', currentPanelWidth + 'px');
                        editorResizeHandle.setAttribute('aria-valuenow', String(currentPanelWidth));
                        if (persist) savePreviewPreference('editorPanelWidth', currentPanelWidth);
                        applyPreviewView();
                    }

                    function toggleEditor(open, persist = true) {
                        editorOpen = typeof open === 'boolean' ? open : !editorOpen;
                        previewSettings.editorOpen = editorOpen;
                        if (!editorOpen && editorPanel.contains(document.activeElement)) editorToggle.focus();
                        if (editorOpen && window.innerWidth <= 680) hideQuestionToolbar();
                        document.body.classList.toggle('editor-open', editorOpen);
                        editorToggle.classList.toggle('active', editorOpen);
                        editorToggle.setAttribute('aria-pressed', String(editorOpen));
                        editorToggle.setAttribute('aria-expanded', String(editorOpen));
                        editorPanel.setAttribute('aria-hidden', String(!editorOpen));
                        editorPanel.inert = !editorOpen;
                        if (persist) savePreviewPreference('editorOpen', editorOpen);
                        requestAnimationFrame(() => {
                            applyPreviewView();
                            scheduleQuestionToolbarPosition();
                        });
                    }

                    function scheduleSettingsSave() {
                        clearTimeout(settingsSaveTimer);
                        setSaveStatus('正在保存…');
                        settingsSaveTimer = window.setTimeout(savePrintSettings, 180);
                    }

                    function applyEditorSettings() {
                        Object.assign(previewSettings, readSettingsFromEditor());
                        currentLayout = previewSettings.previewLayout;
                        currentZoom = previewSettings.previewZoom;
                        applyDocumentStyles();
                        applyPreviewView();
                        applyBlockEditsToSource();
                        scheduleRender();
                        scheduleSettingsSave();
                    }

                    function queueEditorSettings() {
                        clearTimeout(editorApplyTimer);
                        editorApplyTimer = window.setTimeout(applyEditorSettings, 60);
                    }

                    function getAutoScale() {
                        const pageCount = currentLayout === 'double' && window.innerWidth > 680 ? 2 : 1;
                        const gap = window.innerWidth <= 680 ? 12 : clamp(previewSettings.pageGap, 8, 48, 20);
                        const padding = window.innerWidth <= 680 ? 24 : 48;
                        const available = Math.max(220, pageViewport.clientWidth - padding - gap * (pageCount - 1));
                        return Math.max(0.32, Math.min(1, available / (paperWidthPx * pageCount)));
                    }

                    function applyPreviewView(zoomFocus = null) {
                        const readingAnchor = zoomFocus ? null : captureReadingAnchor();
                        currentScale = currentZoom === 'auto'
                            ? getAutoScale()
                            : Math.max(0.25, Math.min(2, Number(currentZoom) || 1));
                        const root = document.documentElement;
                        root.style.setProperty('--preview-scale', String(currentScale));
                        root.style.setProperty('--paper-display-width', (paperWidthPx * currentScale) + 'px');
                        root.style.setProperty('--paper-display-height', (paperHeightPx * currentScale) + 'px');
                        paperContainer.classList.toggle('layout-single', currentLayout === 'single');
                        paperContainer.classList.toggle('layout-double', currentLayout === 'double');

                        document.querySelectorAll('[data-layout]').forEach(button => {
                            button.classList.toggle('active', button.dataset.layout === currentLayout);
                            button.setAttribute('aria-pressed', String(button.dataset.layout === currentLayout));
                        });
                        const zoomValue = document.getElementById('zoom-value');
                        zoomValue.textContent = (currentZoom === 'auto' ? '自动 ' : '') + Math.round(currentScale * 100) + '%';
                        requestAnimationFrame(() => {
                            if (zoomFocus) restoreZoomFocus(zoomFocus);
                            else restoreReadingAnchor(readingAnchor);
                            scheduleQuestionToolbarPosition();
                        });
                    }

                    function setPreviewLayout(layout) {
                        if (!['single', 'double'].includes(layout)) return;
                        currentLayout = layout;
                        previewSettings.previewLayout = layout;
                        applyPreviewView();
                        savePreviewPreference('previewLayout', layout);
                        savePrintSettings();
                    }

                    function setPreviewZoom(zoom, focusPoint = null) {
                        const zoomFocus = focusPoint && zoom !== 'auto'
                            ? captureZoomFocus(focusPoint.clientX, focusPoint.clientY)
                            : null;
                        currentZoom = zoom === 'auto' ? 'auto' : String(Math.max(0.25, Math.min(2, Number(zoom) || 1)));
                        previewSettings.previewZoom = currentZoom;
                        applyPreviewView(zoomFocus);
                        clearTimeout(zoomPreferenceTimer);
                        zoomPreferenceTimer = window.setTimeout(() => {
                            savePreviewPreference('previewZoom', currentZoom);
                            savePrintSettings();
                        }, 180);
                    }

                    function stepPreviewZoom(direction) {
                        const base = currentScale;
                        const candidates = direction > 0
                            ? zoomSteps.filter(value => value > base + 0.01)
                            : zoomSteps.filter(value => value < base - 0.01).reverse();
                        setPreviewZoom(candidates[0] || (direction > 0 ? zoomSteps[zoomSteps.length - 1] : zoomSteps[0]));
                    }

                    function getRenderedFragments(blockId) {
                        if (!blockId) return [];
                        return Array.from(paperContainer.querySelectorAll('.q-wrapper'))
                            .filter(fragment => fragment.dataset.blockId === blockId);
                    }

                    function captureZoomFocus(clientX, clientY) {
                        const hit = document.elementFromPoint(clientX, clientY);
                        const paper = hit?.closest?.('.paper');
                        if (!paper) return null;
                        const papers = Array.from(paperContainer.querySelectorAll('.paper'));
                        const paperIndex = papers.indexOf(paper);
                        const rect = paper.getBoundingClientRect();
                        if (paperIndex < 0 || !rect.width || !rect.height) return null;
                        return {
                            paperIndex,
                            xRatio: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
                            yRatio: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
                            clientX,
                            clientY
                        };
                    }

                    function restoreZoomFocus(focus) {
                        if (!focus) return;
                        const paper = paperContainer.querySelectorAll('.paper')[focus.paperIndex];
                        if (!paper) return;
                        const rect = paper.getBoundingClientRect();
                        const focusedX = rect.left + rect.width * focus.xRatio;
                        const focusedY = rect.top + rect.height * focus.yRatio;
                        pageViewport.scrollLeft += focusedX - focus.clientX;
                        pageViewport.scrollTop += focusedY - focus.clientY;
                    }

                    function zoomAtPoint(deltaY, clientX, clientY) {
                        const rawFactor = Math.exp(-deltaY * 0.002);
                        const factor = Math.max(0.85, Math.min(1.15, rawFactor));
                        const nextScale = Math.max(0.25, Math.min(2, currentScale * factor));
                        if (Math.abs(nextScale - currentScale) < 0.001) return;
                        setPreviewZoom(String(Math.round(nextScale * 1000) / 1000), { clientX, clientY });
                    }

                    function captureReadingAnchor() {
                        const viewportRect = pageViewport.getBoundingClientRect();
                        if (!viewportRect.height) return null;

                        if (activeBlockId) {
                            const fragments = getRenderedFragments(activeBlockId);
                            const visible = fragments
                                .map((fragment, index) => ({ fragment, index, rect: fragment.getBoundingClientRect() }))
                                .filter(item => item.rect.bottom > viewportRect.top + 2 && item.rect.top < viewportRect.bottom - 2)
                                .sort((a, b) => Math.abs(a.rect.top - viewportRect.top - 24) - Math.abs(b.rect.top - viewportRect.top - 24));
                            if (visible[0]) {
                                return {
                                    blockId: activeBlockId,
                                    fragmentIndex: visible[0].index,
                                    offset: visible[0].rect.top - viewportRect.top
                                };
                            }
                        }

                        const shells = Array.from(paperContainer.querySelectorAll('.paper-shell'));
                        const pageIndex = shells.findIndex(shell => shell.getBoundingClientRect().bottom > viewportRect.top + 8);
                        if (pageIndex < 0) return null;
                        return {
                            pageIndex,
                            offset: shells[pageIndex].getBoundingClientRect().top - viewportRect.top
                        };
                    }

                    function restoreReadingAnchor(anchor) {
                        if (!anchor) return;
                        const viewportRect = pageViewport.getBoundingClientRect();
                        let target = null;
                        if (anchor.blockId) {
                            const fragments = getRenderedFragments(anchor.blockId);
                            target = fragments[Math.min(Math.max(0, Number(anchor.fragmentIndex) || 0), Math.max(0, fragments.length - 1))] || null;
                        } else if (Number.isInteger(anchor.pageIndex)) {
                            target = paperContainer.querySelectorAll('.paper-shell')[anchor.pageIndex] || null;
                        }
                        if (!target) return;
                        const delta = target.getBoundingClientRect().top - viewportRect.top - (Number(anchor.offset) || 0);
                        if (Math.abs(delta) > 0.5) pageViewport.scrollTop += delta;
                    }

                    function setQuestionToolbarVisible(visible) {
                        questionToolbar.classList.toggle('is-visible', visible);
                        questionToolbar.setAttribute('aria-hidden', String(!visible));
                    }

                    function hideQuestionToolbar(clearSelection = true) {
                        setQuestionToolbarVisible(false);
                        if (clearSelection) {
                            activeBlockId = '';
                            questionToolbar.dataset.activeBlockId = '';
                            paperContainer.querySelectorAll('.q-wrapper.is-selected').forEach(fragment => fragment.classList.remove('is-selected'));
                        }
                    }

                    function updateQuestionToolbarState() {
                        if (!activeBlockId) return;
                        questionToolbar.dataset.activeBlockId = activeBlockId;
                        const sourceWrapper = Array.from(sourceContent.querySelectorAll('.q-wrapper'))
                            .find(wrapper => wrapper.dataset.blockId === activeBlockId);
                        if (!sourceWrapper) {
                            hideQuestionToolbar();
                            return;
                        }
                        const state = getBlockEdit(activeBlockId);
                        document.getElementById('question-toolbar-label').textContent = sourceWrapper.dataset.blockLabel || '当前题目';
                        document.getElementById('question-line-count').textContent = state.extraLines + ' 行';
                        const removeButton = questionToolbar.querySelector('[data-question-action="remove-line"]');
                        const clearButton = questionToolbar.querySelector('[data-question-action="clear"]');
                        removeButton.disabled = state.extraLines <= 0;
                        clearButton.disabled = state.extraLines <= 0 && !state.breakBefore && !state.breakAfter;
                        ['before', 'after'].forEach(side => {
                            const button = questionToolbar.querySelector('[data-question-action="break-' + side + '"]');
                            button.setAttribute('aria-pressed', String(Boolean(state['break' + side[0].toUpperCase() + side.slice(1)])));
                        });
                        const wrappers = Array.from(sourceContent.querySelectorAll('.q-wrapper'));
                        questionToolbar.querySelector('[data-question-action="break-before"]').disabled = wrappers[0] === sourceWrapper;
                    }

                    function scheduleQuestionToolbarPosition() {
                        if (toolbarPositionFrame) cancelAnimationFrame(toolbarPositionFrame);
                        toolbarPositionFrame = requestAnimationFrame(() => {
                            toolbarPositionFrame = 0;
                            positionQuestionToolbar();
                        });
                    }

                    function positionQuestionToolbar() {
                        if (!activeBlockId || (editorOpen && window.innerWidth <= 680)) {
                            setQuestionToolbarVisible(false);
                            return;
                        }
                        setQuestionToolbarVisible(true);
                    }

                    function activateQuestion(wrapper) {
                        const blockId = wrapper?.dataset.blockId;
                        if (!blockId) return;
                        activeBlockId = blockId;
                        questionToolbar.dataset.activeBlockId = blockId;
                        paperContainer.querySelectorAll('.q-wrapper').forEach(fragment => {
                            fragment.classList.toggle('is-selected', fragment.dataset.blockId === blockId);
                        });
                        updateQuestionToolbarState();
                        scheduleQuestionToolbarPosition();
                    }

                    // 在容器上做事件委托，只绑定一次，避免每次渲染重复 addEventListener
                    let questionInteractionsBound = false;
                    function bindRenderedQuestionInteractions() {
                        if (questionInteractionsBound) return;
                        questionInteractionsBound = true;
                        const findWrapper = target => target && target.closest ? target.closest('.q-wrapper') : null;
                        // 点击切换：点题目内→选中/取消选中（已选中则取消），点题目外→收起工具栏
                        paperContainer.addEventListener('click', event => {
                            const wrapper = findWrapper(event.target);
                            if (wrapper) {
                                event.stopPropagation();
                                // 已选中的题目再次点击 → 取消选中
                                if (wrapper.dataset.blockId === activeBlockId) {
                                    hideQuestionToolbar();
                                } else {
                                    activateQuestion(wrapper);
                                }
                            } else {
                                hideQuestionToolbar();
                            }
                        });
                    }

                    function performQuestionAction(action) {
                        if (!activeBlockId) return;
                        const state = getBlockEdit(activeBlockId);
                        if (action === 'remove-line') state.extraLines = Math.max(0, state.extraLines - 1);
                        else if (action === 'add-line') state.extraLines = Math.min(40, state.extraLines + 1);
                        else if (action === 'add-lines') state.extraLines = Math.min(40, state.extraLines + 4);
                        else if (action === 'break-before') state.breakBefore = !state.breakBefore;
                        else if (action === 'break-after') state.breakAfter = !state.breakAfter;
                        else if (action === 'clear') {
                            state.extraLines = 0;
                            state.breakBefore = false;
                            state.breakAfter = false;
                        } else return;

                        if (!state.extraLines && !state.breakBefore && !state.breakAfter) delete blockEdits[activeBlockId];
                        applyBlockEditsToSource();
                        updateQuestionToolbarState();
                        scheduleRender();
                        scheduleSettingsSave();
                    }

                    function createPaper() {
                        const shell = document.createElement('div');
                        shell.className = 'paper-shell';
                        const paper = document.createElement('section');
                        paper.className = 'paper';
                        paper.innerHTML = '<div class="paper-content"></div><div class="page-footer"></div>';
                        shell.appendChild(paper);
                        paperContainer.appendChild(shell);
                        return { paper: paper, content: paper.querySelector('.paper-content') };
                    }

                    function pageHasContent(content) {
                        return Array.from(content.children).some(el => !el.classList.contains('manual-break-indicator'));
                    }

                    function hasPrintableContent(node) {
                        const copy = node.cloneNode(true);
                        copy.querySelectorAll('.q-toolbar').forEach(el => el.remove());
                        if (copy.textContent.replace(/\s/g, '')) return true;
                        return !!copy.querySelector('img, table, svg, canvas, mjx-container, .MathJax, .katex, .answer-blank, .answer-blank-large');
                    }

                    function nodeOverflowsPage(node, pageContent) {
                        const pageBottom = pageContent.getBoundingClientRect().bottom;
                        if (node.classList.contains('q-wrapper')) {
                            // 题目的段后距可以落在页边距中；优先按真实文字行和不可拆元素判定溢出。
                            if (findOverflowBoundary(node, pageBottom)) return true;
                            // 兜底：边界算法可能漏判（如内容整体由 div/MathJye 构成、无文本节点），
                            // 此时若几何位置已明显越过页底，仍按溢出处理，避免整块被硬塞后被裁切。
                            return node.getBoundingClientRect().bottom > pageBottom + overflowTolerance;
                        }
                        return node.getBoundingClientRect().bottom > pageBottom + overflowTolerance;
                    }

                    function boundaryBefore(element, blockOnly) {
                        // blockOnly=true 时，只允许在「块级元素」之间断开：
                        // 行内内容（文本片段、.MathJye 公式等）与其前后的运算符同属一行，
                        // 从它们之间断开会出现「= 与后面的公式分家」这类问题。
                        // 做法是向上寻找最近的块级祖先，在其之前断开。
                        if (blockOnly) {
                            const isBlockLevel = el => {
                                const display = getComputedStyle(el).display;
                                return display === 'block' || display === 'flex' || display === 'grid'
                                    || display === 'list-item' || display === 'table' || display === 'flow-root';
                            };
                            let target = element;
                            let guard = 0;
                            while (target && target.parentElement && guard++ < 4) {
                                if (isBlockLevel(target)) {
                                    const parent = target.parentNode;
                                    if (!parent) return null;
                                    return { container: parent, offset: Array.prototype.indexOf.call(parent.childNodes, target) };
                                }
                                target = target.parentElement;
                            }
                            return null;
                        }
                        const parent = element.parentNode;
                        if (!parent) return null;
                        return { container: parent, offset: Array.prototype.indexOf.call(parent.childNodes, element) };
                    }

                    function textOverflowBoundary(textNode, pageBottom) {
                        if (!textNode.data.length) return null;
                        const fullRange = document.createRange();
                        fullRange.selectNodeContents(textNode);
                        const overflows = Array.from(fullRange.getClientRects()).some(rect => rect.bottom > pageBottom + overflowTolerance);
                        if (!overflows) return null;

                        // 二分查找第一个落在下一页的字符。同一行的字符共享底边，
                        // 因此切点会落在整行之前，不会把一行截成两半。
                        let low = 0;
                        let high = textNode.data.length - 1;
                        while (low < high) {
                            const middle = Math.floor((low + high) / 2);
                            const range = document.createRange();
                            range.setStart(textNode, 0);
                            range.setEnd(textNode, middle + 1);
                            const prefixOverflows = Array.from(range.getClientRects()).some(rect => rect.bottom > pageBottom + overflowTolerance);
                            if (prefixOverflows) high = middle;
                            else low = middle + 1;
                        }
                        return { container: textNode, offset: low };
                    }

                    // 几何兜底边界：沿元素树找到第一个「顶部已经落到页底之后」的块，
                    // 返回该块在其父节点中的位置作为拆分点。用于边界算法漏判时仍能拆页。
                    function geometricBoundary(root, pageBottom) {
                        const wholeSelector = '.pt3, .pt4, .pt5, .pt6, .pt7, .pt11';
                        function walk(parent) {
                            for (const child of Array.from(parent.children)) {
                                if (child.classList.contains('q-toolbar')) continue;
                                const rect = child.getBoundingClientRect();
                                if (rect.height <= 0) continue;
                                // 答案区子块整体处理：放不下就在它之前断开，不深入其内部拆分
                                if (child.matches(wholeSelector)) {
                                    if (rect.bottom > pageBottom + overflowTolerance) {
                                        const offset = Array.prototype.indexOf.call(parent.childNodes, child);
                                        if (offset > 0) return { container: parent, offset };
                                    }
                                    continue;
                                }
                                if (rect.top >= pageBottom - overflowTolerance) {
                                    const offset = Array.prototype.indexOf.call(parent.childNodes, child);
                                    if (offset > 0) return { container: parent, offset };
                                }
                                const nested = walk(child);
                                if (nested) return nested;
                            }
                            return null;
                        }
                        return walk(root);
                    }

                    // allowBreakInsideAnswer=true 时，不再把答案子块视为整体，允许在其内部按行断开。
                    // 仅用于「整块放到空页仍放不下」的兜底，避免超长【解答】被裁切。
                    function findOverflowBoundary(root, pageBottom, allowBreakInsideAnswer, blockOnly) {
                        // .pt3/.pt4/.pt5/.pt6/.pt7/.pt11 为答案区子块（【考点】【答案】【分析】【解答】）：
                        // 它们整体不可拆分 —— 若放不下，应在该块之前断开、整块移到下一页，
                        // 而不是从块中间切开导致内容显示不全。
                        const atomicSelector = allowBreakInsideAnswer
                            ? 'img, table, svg, canvas, pre, br, mjx-container, .MathJax, .katex, .MathJye, .answer-blank, .answer-blank-large'
                            : 'img, table, svg, canvas, pre, br, mjx-container, .MathJax, .katex, .MathJye, .answer-blank, .answer-blank-large, .pt3, .pt4, .pt5, .pt6, .pt7, .pt11';

                        function visit(parent) {
                            for (const child of Array.from(parent.childNodes)) {
                                if (child.nodeType === Node.TEXT_NODE) {
                                    const boundary = textOverflowBoundary(child, pageBottom);
                                    if (boundary) return boundary;
                                    continue;
                                }
                                if (child.nodeType !== Node.ELEMENT_NODE || child.classList.contains('q-toolbar')) continue;

                                const rect = child.getBoundingClientRect();
                                if (rect.top >= pageBottom - overflowTolerance && hasPrintableContent(child)) {
                                    return boundaryBefore(child, blockOnly);
                                }
                                if (child.matches(atomicSelector)) {
                                    if (rect.bottom > pageBottom + overflowTolerance) return boundaryBefore(child, blockOnly);
                                    continue;
                                }

                                const nestedBoundary = visit(child);
                                if (nestedBoundary) return nestedBoundary;

                                // 兼容没有文字节点、但自身有高度的站点组件：
                                // 如公式 SVG、视频/音频占位、空 div 等（组卷网部分组件渲染后占高但无文本）。
                                // 若其底部越过页底，则当作分页边界处理，避免整块被硬塞在上一页溢出。
                                if (rect.bottom > pageBottom + overflowTolerance && !child.textContent.trim()) {
                                    return boundaryBefore(child, blockOnly);
                                }
                            }
                            return null;
                        }

                        return visit(root);
                    }

                    function preserveQuestionIndent(fragment, original) {
                        const layout = fragment.querySelector('.zujuanjs-question-layout');
                        if (!layout || layout.querySelector('.zujuanjs-question-number')) return;
                        const originalNumber = original.querySelector('.zujuanjs-question-number');
                        if (!originalNumber) return;
                        const placeholder = originalNumber.cloneNode(true);
                        placeholder.classList.add('continuation-placeholder');
                        placeholder.setAttribute('aria-hidden', 'true');
                        layout.insertBefore(placeholder, layout.firstChild);
                    }

                    function splitQuestionAt(node, boundary) {
                        if (!boundary) return null;
                        const firstRange = document.createRange();
                        firstRange.selectNodeContents(node);
                        firstRange.setEnd(boundary.container, boundary.offset);

                        const secondRange = document.createRange();
                        secondRange.selectNodeContents(node);
                        secondRange.setStart(boundary.container, boundary.offset);

                        const first = node.cloneNode(false);
                        const second = node.cloneNode(false);
                        first.appendChild(firstRange.cloneContents());
                        second.appendChild(secondRange.cloneContents());
                        preserveQuestionIndent(first, node);
                        preserveQuestionIndent(second, node);

                        first.classList.add('continues-on-next');
                        second.classList.remove('continues-on-next');
                        second.classList.add('continued-from-previous');

                        if (!hasPrintableContent(first) || !hasPrintableContent(second)) return null;
                        return { first: first, second: second };
                    }

                    function addManualBreakMarker(pageContent) {
                        const marker = document.createElement('div');
                        marker.className = 'manual-break-indicator';
                        pageContent.appendChild(marker);
                    }

                    function updatePageNumbers() {
                        const papers = Array.from(paperContainer.querySelectorAll('.paper'));
                        // 检测哪些页是答案页（包含答案条目或答案标题）
                        const isAnswerPage = paper => !!paper.querySelector('.zujuanjs-answer-entry, .zujuanjs-answers-header');
                        let qPage = 0, aPage = 0;
                        papers.forEach((paper, index) => {
                            const footer = paper.querySelector('.page-footer');
                            footer.style.display = previewSettings.showPageNumber === false ? 'none' : '';
                            if (previewSettings.showPageNumber === false) return;
                            if (isAnswerPage(paper)) {
                                aPage++;
                            } else {
                                qPage++;
                            }
                        });
                        let qi = 0, ai = 0;
                        papers.forEach((paper) => {
                            const footer = paper.querySelector('.page-footer');
                            if (isAnswerPage(paper)) {
                                footer.textContent = '答案 ' + (++ai) + ' / ' + aPage;
                            } else {
                                footer.textContent = (++qi) + ' / ' + qPage;
                            }
                        });
                        // 总页数显示：试题页 + 答案页
                        const totalText = (qPage && aPage)
                            ? ('共 ' + qPage + ' 页（试题）+ ' + aPage + ' 页（答案）')
                            : ('共 ' + papers.length + ' 页');
                        document.getElementById('preview-page-count').textContent = totalText;
                    }

                    function renderPages() {
                        if (isRendering) {
                            renderAgain = true;
                            return;
                        }
                        isRendering = true;
                        const readingAnchor = pendingReadingAnchor || captureReadingAnchor();
                        pendingReadingAnchor = null;
                        paperContainer.textContent = '';

                        const queue = Array.from(sourceContent.children, child => child.cloneNode(true));
                        let page = createPaper();
                        let guard = 0;
                        let answersBreakDone = false; // 答案区是否已强制分页，避免重复分页

                        // 当前页已有内容则翻到新页（并补手动分页标记），随后标记答案区已分页。
                        // 既用于显式 .page-break，也用于参考答案标题/首个答案条目兜底分页，避免重复代码。
                        function forceNewPageIfHasContent() {
                            if (pageHasContent(page.content)) {
                                addManualBreakMarker(page.content);
                                page = createPaper();
                            }
                            answersBreakDone = true;
                        }

                        while (queue.length && guard < MAX_PAGINATE_ITER) {
                            guard++;
                            const node = queue.shift();

                            if (node.classList.contains('page-break')) {
                                forceNewPageIfHasContent();
                                continue;
                            }

                            // 兜底：若 .page-break 未被检测到，遇到参考答案标题或首个答案条目时强制从新页开始
                            const isAnswersHeader = node.classList.contains('zujuanjs-answers-header');
                            const isAnswerEntry = node.classList.contains('zujuanjs-answer-entry');
                            if ((isAnswersHeader || isAnswerEntry) && !answersBreakDone) {
                                forceNewPageIfHasContent();
                            }

                            const pageAlreadyHasContent = pageHasContent(page.content);
                            page.content.appendChild(node);
                            // 答案块（内联 / 附末尾）改用纯几何判定：
                            // 边界算法对「全 div + MathJye 组成、几乎无裸文本」的内容容易漏判，
                            // 判成"放得下"就会整块硬塞并被 .paper-content{overflow:hidden} 裁掉。
                            const isAnswerBlock = node.classList.contains('zujuanjs-inline-answer')
                                || node.classList.contains('zujuanjs-answer-entry');
                            let blockOverflows;
                            if (isAnswerBlock) {
                                const _r = node.getBoundingClientRect();
                                const _pb = page.content.getBoundingClientRect().bottom;
                                blockOverflows = _r.bottom > _pb + overflowTolerance;
                            } else {
                                blockOverflows = nodeOverflowsPage(node, page.content);
                            }
                            if (!blockOverflows) {
                                // 章节标题 keep-with-next：标题本身放得下，但若紧随的题目放不下，
                                // 则把标题也推到下一页，避免「标题孤悬底部、题目跑到下页」。
                                // 原条件要求「当前页已有内容」，但标题若是页首元素（如刚翻页后）该条件不成立，
                                // 于是标题留在页尾、题目被推到下页，形成孤悬的标题页。去掉该限制。
                                if (node.classList.contains('zujuanjs-section-title') && queue.length > 0) {
                                    const nextNode = queue[0];
                                    if (nextNode && nextNode.classList.contains('q-wrapper')) {
                                        const nextClone = nextNode.cloneNode(true);
                                        page.content.appendChild(nextClone);
                                        const nextOverflows = nodeOverflowsPage(nextClone, page.content);
                                        page.content.removeChild(nextClone);
                                        if (nextOverflows) {
                                            node.remove();
                                            page = createPaper();
                                            page.content.appendChild(node);
                                            queue.unshift(nextNode);
                                        }
                                    }
                                }
                                continue;
                            }

                            // 题目不跨页：当前页已有内容、整题放不下时，整题移到下一页，不在题内拆分。
                            // 仅当题目本身超过一整页（建到空页仍溢出）才允许拆分，避免死循环。
                            if (node.classList.contains('q-wrapper') && pageAlreadyHasContent) {
                                node.remove();
                                page = createPaper();
                                queue.unshift(node);
                                continue;
                            }

                            let split = null;
                            if (node.classList.contains('q-wrapper')) {
                                const pageBottom = page.content.getBoundingClientRect().bottom;
                                let boundary = findOverflowBoundary(node, pageBottom);
                                let usedFallback = false;
                                if (!boundary) {
                                    boundary = geometricBoundary(node, pageBottom);
                                    usedFallback = !!boundary;
                                }
                                split = splitQuestionAt(node, boundary);
                                if (!split) {
                                    // 兜底：整块（或其内部单个子块）高过一页时，允许在答案子块内部按行拆分，
                                    // 保证超长【解答】也能跨页完整显示，而不是被裁切。
                                    // 一级：允许块内拆分，但断点仍要求落在块级边界（不切行内内容）
                                    let looseBoundary = findOverflowBoundary(node, pageBottom, true, true);
                                    split = splitQuestionAt(node, looseBoundary);
                                    if (!split) {
                                        // 二级：块级边界无处可断（例如整个解答就是单个 .pt6，其内部全是行内内容），
                                        // 退回行内边界；宁可断点略碎，也要保证内容完整显示而不是被裁。
                                        looseBoundary = findOverflowBoundary(node, pageBottom, true, false);
                                        split = splitQuestionAt(node, looseBoundary);
                                    }
                                }
                                if (!split) {
                                    const rect = node.getBoundingClientRect();
                                    console.warn('[组卷打印] 分页：题目（' + (node.dataset.blockId || '?')
                                        + '）高过一页且无法拆分（边界=' + (boundary ? (usedFallback ? '几何兜底' : '已找到') : '未找到')
                                        + '），题目 top=' + rect.top.toFixed(1) + ' bottom=' + rect.bottom.toFixed(1)
                                        + '，页底=' + pageBottom.toFixed(1)
                                        + '，超出 ' + (rect.bottom - pageBottom).toFixed(1) + 'px，整块保留在本页');
                                }
                            }

                            if (split) {
                                node.remove();
                                page.content.appendChild(split.first);
                                // 用几何判定前半是否真的放得下：边界算法对 div/MathJye 组成的内容会漏判，
                                // 误判为「放得下」会把拆分结果当成有效，实际却溢出被裁。
                                const _firstRect = split.first.getBoundingClientRect();
                                const _pageBottom = page.content.getBoundingClientRect().bottom;
                                const _firstFits = _firstRect.bottom <= _pageBottom + overflowTolerance;
                                if (!_firstFits) {
                                    // 前半仍超出（常见于断点因公式等不可拆元素而后移，通常只差几像素）。
                                    // 此时不放弃拆分，而是把前半重新入队继续细分，直到放进本页为止，
                                    // 避免「拆了但结果被丢弃 → 整块硬塞 → 尾部被裁」。
                                    split.first.remove();
                                    // 注意入队顺序：unshift 是往前插，故先放后半、再放前半，
                                    // 保证先处理前半（继续细分），后半紧随其后，避免内容丢失。
                                    queue.unshift(split.second);
                                    queue.unshift(split.first);
                                    continue;
                                }
                                if (_firstFits) {
                                    page = createPaper();
                                    queue.unshift(split.second);
                                    continue;
                                }
                                split.first.remove();
                            } else {
                                node.remove();
                            }

                            if (pageAlreadyHasContent) {
                                page = createPaper();
                                queue.unshift(node);
                            } else {
                                // 超过一整页且无法拆分的单个图片/表格，保留在本页以避免死循环。
                                page.content.appendChild(node);
                            }
                        }

                        // 清理空白页：原逻辑只从尾部逐个删，遇到「中间出现空白页」就提前 break 了。
                        // 当一整题放不进当前页时会先移到新页，中途可能留下完全没有子元素的页，
                        // 这里改为全量扫描，删掉除首页外所有「一个子元素都没有」的页。
                        // 注意：带手动分页标记（.manual-break-indicator）的页有子元素，不会被误删。
                        Array.from(paperContainer.querySelectorAll('.paper')).forEach((paper, index) => {
                            if (index === 0) return;
                            const content = paper.querySelector('.paper-content');
                            if (content && content.children.length === 0) {
                                paper.closest('.paper-shell')?.remove();
                            }
                        });

                        updatePageNumbers();
                        renderVersion++;
                        paperContainer.dataset.renderVersion = String(renderVersion);
                        if (activeBlockId) {
                            paperContainer.querySelectorAll('.q-wrapper').forEach(fragment => {
                                fragment.classList.toggle('is-selected', fragment.dataset.blockId === activeBlockId);
                            });
                        }
                        bindRenderedQuestionInteractions();
                        restoreReadingAnchor(readingAnchor);
                        updateQuestionToolbarState();
                        scheduleQuestionToolbarPosition();
                        try { window.parent.postMessage({ type: 'zujuanPreviewRendered', token: PREVIEW_TOKEN }, '*'); } catch (e) {}
                        isRendering = false;
                        document.dispatchEvent(new CustomEvent('zujuan-preview-rendered', {
                            detail: { version: renderVersion, pages: paperContainer.querySelectorAll('.paper').length }
                        }));
                        if (renderAgain) {
                            renderAgain = false;
                            scheduleRender();
                        }
                    }

                    function scheduleRender() {
                        if (renderFrame) cancelAnimationFrame(renderFrame);
                        renderFrame = requestAnimationFrame(function() {
                            renderFrame = 0;
                            renderPages();
                        });
                    }

                    // 菁优网：从单题页获取答案与考点。抓取在父窗口执行（需要真实页面环境），
                    // 这里只负责发指令、显示进度，抓到后由父窗口通知，再走已有的增量重建流程。
                    const siteDetailBtn = document.getElementById('site-detail-btn');
                    if (siteDetailBtn && previewSettings.siteDetailFetch) {
                        siteDetailBtn.style.display = '';
                        siteDetailBtn.addEventListener('click', function() {
                            if (siteDetailBtn.dataset.busy === '1') return;
                            siteDetailBtn.dataset.busy = '1';
                            siteDetailBtn.textContent = '正在获取…';
                            window.parent.postMessage({ type: 'fetchSiteDetails', token: PREVIEW_TOKEN }, '*');
                        });
                    }

                    // 内容类复选框（试题/知识点/答案/答案附末尾）改动：通过 postMessage 触发父级增量重建，
                    // 父级只把新的题目内容 HTML 发回 iframe 内部替换 sourceContent 并重渲染，不再重载 iframe（避免黑屏闪烁）。
                    // 加防抖，避免连续勾选时反复重建。
                    let rebuildTimer = 0;
                    function scheduleRebuild() {
                        if (rebuildTimer) clearTimeout(rebuildTimer);
                        rebuildTimer = setTimeout(function() {
                            rebuildTimer = 0;
                            const nextSettings = readSettingsFromEditor();
                            window.parent.postMessage({ type: 'rebuildZujuanPreview', settings: nextSettings, token: PREVIEW_TOKEN }, '*');
                        }, 150);
                    }

                    document.querySelectorAll('[data-layout]').forEach(button => {
                        button.addEventListener('click', () => setPreviewLayout(button.dataset.layout));
                    });
                    document.querySelector('[data-zoom="out"]').addEventListener('click', () => stepPreviewZoom(-1));
                    document.querySelector('[data-zoom="in"]').addEventListener('click', () => stepPreviewZoom(1));
                    document.querySelector('[data-zoom="auto"]').addEventListener('click', () => setPreviewZoom('auto'));
                    editorToggle.addEventListener('click', () => toggleEditor());

                    document.querySelectorAll('[data-editor-tab]').forEach(button => {
                        button.addEventListener('click', () => setEditorTab(button.dataset.editorTab));
                        button.addEventListener('keydown', event => {
                            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                            event.preventDefault();
                            const nextTab = button.dataset.editorTab === 'document' ? 'page' : 'document';
                            setEditorTab(nextTab);
                            document.querySelector('[data-editor-tab="' + nextTab + '"]').focus();
                        });
                    });

                    document.querySelectorAll('[data-layout-preset]').forEach(button => {
                        button.addEventListener('click', () => applyLayoutPreset(button.dataset.layoutPreset));
                    });

                    // 步进器输入框：输入时实时 clamp 到自身 min/max，捕获阶段先执行，保证后续 input 监听器读到已修正值
                    document.querySelectorAll('.bl-stepper-input-wrap input').forEach(input => {
                        input.addEventListener('input', () => {
                            const raw = Number(input.value);
                            if (!Number.isFinite(raw)) return;
                            const min = Number.isFinite(Number(input.min)) ? Number(input.min) : 0;
                            const max = Number.isFinite(Number(input.max)) ? Number(input.max) : 24;
                            const clamped = Math.max(min, Math.min(max, Math.round(raw)));
                            if (String(clamped) !== input.value) input.value = String(clamped);
                        }, true);
                    });

                    const editorControls = Array.from(editorPanel.querySelectorAll('input, select'));
                    editorControls.forEach(control => {
                        const eventName = control.tagName === 'INPUT' && ['text', 'number'].includes(control.type) ? 'input' : 'change';
                        control.addEventListener(eventName, () => {
                            previewSettings.layoutPreset = 'custom';
                            updateLayoutPresetUI();
                            if (control.id === 'setting-answers-at-end') {
                                // 答案附末尾 必须与 答案 关联：勾选"答案附末尾"时自动勾选"答案"
                                if (control.checked) {
                                    const answerCb = document.querySelector('input[name="setting-content"][value="a"]');
                                    if (answerCb && !answerCb.checked) answerCb.checked = true;
                                }
                                scheduleRebuild();
                                savePrintSettings();
                                return;
                            }
                            if (control.name === 'setting-content') {
                                // 取消"答案"时，连带取消"答案附末尾"
                                if (control.value === 'a' && !control.checked) {
                                    const atEndCb = document.getElementById('setting-answers-at-end');
                                    if (atEndCb && atEndCb.checked) atEndCb.checked = false;
                                }
                                scheduleRebuild();
                                savePrintSettings();
                                return;
                            }
                            if (control.id === 'setting-mode') {
                                scheduleRebuild();
                                savePrintSettings();
                                return;
                            }
                            if (control.id === 'setting-auto-checkin') {
                                // [S4.2] 自动签到为全局偏好（非单卷设置），单独走 saveZujuanPreviewPreference 通道持久化
                                savePreviewPreference('autoCheckIn', control.checked ? 'true' : 'false');
                                return;
                            }
                            if (control.id === 'setting-self-check') {
                                // [C] 自检模式为全局偏好，单独走 saveZujuanPreviewPreference 通道持久化
                                savePreviewPreference('selfCheck', control.checked ? 'true' : 'false');
                                return;
                            }
                            setSaveStatus('正在保存…');
                            queueEditorSettings();
                        });
                    });

                    // 步进器：− / + 按钮（题型答题行数 + 页面间距共用）
                    document.querySelectorAll('.bl-stepper-btn').forEach(btn => {
                        btn.addEventListener('mousedown', event => {
                            // 阻止按钮获得焦点，保持输入框焦点，从而维持整体焦点高亮
                            event.preventDefault();
                            const input = document.getElementById(btn.dataset.target);
                            if (input) input.focus();
                        });
                        btn.addEventListener('click', () => {
                            const input = document.getElementById(btn.dataset.target);
                            if (!input) return;
                            const step = Number(btn.dataset.step) || 0;
                            const min = Number.isFinite(Number(input.min)) ? Number(input.min) : 0;
                            const max = Number.isFinite(Number(input.max)) ? Number(input.max) : 24;
                            const val = Math.max(min, Math.min(max, Math.round((Number(input.value) || 0) + step)));
                            input.value = String(val);
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                        });
                    });

                    document.getElementById('editor-reset').addEventListener('click', () => {
                        applyLayoutPreset('compact', true);
                    });

                    let resizePointerId = null;
                    let resizeStartX = 0;
                    let resizeStartWidth = currentPanelWidth;
                    editorResizeHandle.addEventListener('pointerdown', event => {
                        if (window.innerWidth <= 680) return;
                        resizePointerId = event.pointerId;
                        resizeStartX = event.clientX;
                        resizeStartWidth = currentPanelWidth;
                        editorResizeHandle.setPointerCapture(event.pointerId);
                        document.body.classList.add('editor-resizing');
                        event.preventDefault();
                    });
                    editorResizeHandle.addEventListener('pointermove', event => {
                        if (event.pointerId !== resizePointerId) return;
                        applyEditorPanelWidth(resizeStartWidth + resizeStartX - event.clientX);
                    });
                    const finishPanelResize = event => {
                        if (event.pointerId !== resizePointerId) return;
                        resizePointerId = null;
                        document.body.classList.remove('editor-resizing');
                        applyEditorPanelWidth(currentPanelWidth, true);
                        scheduleSettingsSave();
                    };
                    editorResizeHandle.addEventListener('pointerup', finishPanelResize);
                    editorResizeHandle.addEventListener('pointercancel', finishPanelResize);
                    editorResizeHandle.addEventListener('keydown', event => {
                        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                        event.preventDefault();
                        if (event.key === 'Home') applyEditorPanelWidth(280, true);
                        else if (event.key === 'End') applyEditorPanelWidth(520, true);
                        else applyEditorPanelWidth(currentPanelWidth + (event.key === 'ArrowLeft' ? 10 : -10), true);
                        scheduleSettingsSave();
                    });

                    questionToolbar.addEventListener('click', event => {
                        const button = event.target.closest('[data-question-action]');
                        if (!button || button.disabled) return;
                        event.preventDefault();
                        performQuestionAction(button.dataset.questionAction);
                    });

                    pageViewport.addEventListener('scroll', scheduleQuestionToolbarPosition, { passive: true });
                    pageViewport.addEventListener('pointerdown', () => pageViewport.focus({ preventScroll: true }));
                    pageViewport.addEventListener('wheel', event => {
                        if (!event.ctrlKey && !event.metaKey) return;
                        event.preventDefault();
                        pageViewport.focus({ preventScroll: true });
                        zoomAtPoint(event.deltaY, event.clientX, event.clientY);
                    }, { passive: false });
                    let gestureStartScale = currentScale;
                    pageViewport.addEventListener('gesturestart', event => {
                        gestureStartScale = currentScale;
                        event.preventDefault();
                    }, { passive: false });
                    pageViewport.addEventListener('gesturechange', event => {
                        event.preventDefault();
                        const viewportRect = pageViewport.getBoundingClientRect();
                        const clientX = Number.isFinite(event.clientX) ? event.clientX : (viewportRect.left + viewportRect.right) / 2;
                        const clientY = Number.isFinite(event.clientY) ? event.clientY : (viewportRect.top + viewportRect.bottom) / 2;
                        setPreviewZoom(String(Math.max(0.25, Math.min(2, gestureStartScale * (Number(event.scale) || 1)))), { clientX, clientY });
                    }, { passive: false });
                    document.addEventListener('keydown', event => {
                        if (event.key === 'Escape' && activeBlockId) {
                            hideQuestionToolbar();
                            return;
                        }
                        const typingTarget = event.target instanceof Element && event.target.closest('input, select, textarea');
                        if ((!event.ctrlKey && !event.metaKey) || event.altKey || typingTarget) return;
                        if (['+', '=', 'Add'].includes(event.key)) {
                            event.preventDefault();
                            stepPreviewZoom(1);
                        } else if (['-', '_', 'Subtract'].includes(event.key)) {
                            event.preventDefault();
                            stepPreviewZoom(-1);
                        } else if (event.key === '0') {
                            event.preventDefault();
                            setPreviewZoom('auto');
                        }
                    });

                    window.addEventListener('load', scheduleRender);
                    window.addEventListener('beforeprint', renderPages);
                    window.addEventListener('resize', () => {
                        if (window.innerWidth <= 680 && editorOpen && activeBlockId) hideQuestionToolbar();
                        if (currentZoom === 'auto') applyPreviewView();
                        else scheduleQuestionToolbarPosition();
                    });
                    if (document.fonts && document.fonts.ready) {
                        document.fonts.ready.then(scheduleRender);
                    }

                    sourceContent.querySelectorAll('img').forEach(img => {
                        if (!img.complete) {
                            img.addEventListener('load', () => {
                                applyFormulaScale();
                                scheduleRender();
                            }, { once: true });
                            img.addEventListener('error', scheduleRender, { once: true });
                        }
                    });
                    editorPanel.classList.add('editor-initializing');
                    applyBlockEditsToSource();
                    writeSettingsToEditor();
                    applyDocumentStyles();
                    applyEditorPanelWidth(currentPanelWidth);
                    setEditorTab(currentEditorTab, false);
                    toggleEditor(editorOpen, false);
                    requestAnimationFrame(() => editorPanel.classList.remove('editor-initializing'));
                    scheduleRender();

                    // 接收父窗口增量更新：仅替换题目内容并重渲染，避免 iframe 整页重载（黑屏闪烁）
                    window.addEventListener('message', function (e) {
                        const d = e.data || {};
                        if (!d || d.token !== PREVIEW_TOKEN) return;
                        if (d.type === 'siteDetailProgress') {
                            const b = document.getElementById('site-detail-btn');
                            if (b) b.textContent = '正在获取 ' + d.done + '/' + d.total;
                            return;
                        }
                        if (d.type === 'siteDetailsReady') {
                            const b = document.getElementById('site-detail-btn');
                            if (b) {
                                b.dataset.busy = '0';
                                if (d.cached) {
                                    // 全部命中缓存：不显示获取进度、也不变回「获取答案/考点」——
                                    // 只有存在失败/未抓取时才需要再次获取（刷新页面后缓存清空会重新可抓）
                                    b.textContent = '已使用缓存';
                                } else {
                                    b.textContent = d.error ? '获取失败' : (d.failed ? '完成，失败 ' + d.failed + ' 题' : '已获取 ' + d.total + ' 题');
                                    setTimeout(function() { b.textContent = '获取答案/考点'; }, 3000);
                                }
                            }
                            // 抓取完成 → 增量重建，让新到手的答案与考点进入预览
                            scheduleRebuild();
                            return;
                        }
                        if (d.type === 'updateZujuanSource' && typeof d.html === 'string') {
                            sourceContent.innerHTML = d.html;
                            // 图片可能尚未从缓存就绪，绑定加载完成后重渲染，保证分页高度准确
                            sourceContent.querySelectorAll('img').forEach(img => {
                                if (!img.complete) {
                                    img.addEventListener('load', () => { applyFormulaScale(); scheduleRender(); }, { once: true });
                                    img.addEventListener('error', scheduleRender, { once: true });
                                }
                            });
                            // 关键：增量重建也必须重新应用公式缩放，否则新注入的公式图片
                            // 没有 style.width，以自然尺寸渲染（比缩放后小）。注入的 html 已自带字体等内联样式，
                            // 无需再 applyDocumentStyles 重写所有题目节点，去掉冗余开销。
                            applyFormulaScale();
                            // [题间距] 增量重建后重新应用文档样式变量（含 --question-spacing），
                            // 确保跨页面复用同一 iframe 时间距等排版变量与当前 settings 一致。
                            applyDocumentStyles();
                            // 增量重建会清空 sourceContent 并重新注入题目节点，必须重新应用 blockEdits
                            //（手动分页/答题空行），否则这些编辑状态会丢失。
                            applyBlockEditsToSource();
                            scheduleRender();
                        }
                    });
                </script>
            </body>
            </html>
            `;
        }

        openPreview(htmlContent) {
            let overlay = document.getElementById('zujuanjs-preview-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'zujuanjs-preview-overlay';
                document.body.appendChild(overlay);
            }
            // 复用同一个 iframe 元素，避免每次重建/销毁带来的布局抖动与对象开销
            let iframe = overlay.querySelector('iframe.zujuanjs-preview-frame');
            if (!iframe) {
                iframe = document.createElement('iframe');
                iframe.className = 'zujuanjs-preview-frame';
                iframe.title = '试卷排版预览';
                // 仅允许脚本运行，不授予同源权限：iframe 无法直接访问 parent.document，
                // 只能通过携带 PREVIEW_TOKEN 的 postMessage 与父级通信，缩小权限面。
                iframe.setAttribute('sandbox', 'allow-scripts allow-modals');
                overlay.appendChild(iframe);
            }
            iframe.srcdoc = htmlContent;
        }
    }

    new PaperPrinter();
})();
