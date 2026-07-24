// ==UserScript==
// @name         组卷网/学科网试卷打印助手
// @version      6.0.0
// @description  所见即所得试卷排版，支持版式预设、自动记忆、公式随字号缩放、顶层题目工具条与题内自然分页
// @author       nuym, WorkingFishQ, xiaohuya
// @match        *://zujuan.xkw.com/*
// @icon         https://zujuan.xkw.com/favicon.ico
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-end
// @license      GNU Affero General Public License v3.0
// ==/UserScript==

(function () {
    'use strict';

    const Config = {
        adSelectors: ['.aside-pop.activity-btn', '.ai-entry.fixed'],
    };

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
                paragraphSpacing: '8', contentAlign: 'left', numberGap: '0.55', answerRowHeight: '1.8', pageGap: '20',
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
        { key: 'answerRowHeight', storage: 'answerRowHeight',   def: '1.8',           type: 'str' },
        { key: 'pageGap',         storage: 'pageGap',           def: '20',            type: 'str' },
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
                            const answersExpanded = this.answersExpandedOnPage();
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
            const selectors = ['.paper-title', '.title-box', 'h1', '.exam-title', '.paper-name'];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim()) return el.textContent.trim().replace(/\s+/g, ' ');
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
            const pageHasExplicitAnswerSwitch = !!document.querySelector(ANSWER_SWITCH_SEL);
            const domRules = [
                { name: '试题根 .tk-quest-item.quesroot', sel: '.tk-quest-item.quesroot', required: true },
                { name: '小节标题 .sec-title/.questypetitle', sel: '.sec-title, .questype-head .questypetitle', required: false },
                { name: '答案开关 #isshowAnswer', sel: ANSWER_SWITCH_SEL, required: false, onlyIfExplicitSwitch: true },
                // 跨页面通用·结构检查：自检在页面加载时运行，而组卷中心答案需手动点开、刷新即丢失，
                // 故「答案当前是否已渲染」属运行时状态，加载那一刻永远不成立，不适合做自检项（会永远失败、误导）。
                // 改为校验脚本提取答案所依赖的结构锚点 .exam-item__opt（答案区所在容器，静态 DOM 中即存在、未展开时为空），
                // 与运行时是否展开无关；真正「答案是否已显示」由打印时的 answersExpandedOnPage() 在用户点击后判定。
                { name: '答案提取锚点 .exam-item__opt', sel: '.exam-item__opt', required: false },
                { name: '打印按钮 .zujuanjs-float-print-btn', sel: '.zujuanjs-float-print-btn', required: true },
                { name: '签到入口 .user-assets-box a[href="/score_task/"]', sel: '.user-assets-box a[href="/score_task/"]', required: false },
            ];
            const domResults = domRules.map(r => {
                let hits = 0;
                try { hits = document.querySelectorAll(r.sel).length; } catch (e) { hits = -1; }
                // 显式答案开关仅适用于试卷详情页；组卷中心无此元素，标记为「不适用」而非「缺失」，避免误报
                if (r.onlyIfExplicitSwitch && !pageHasExplicitAnswerSwitch) {
                    return { 检查项: r.name, 选择器: r.sel, 命中: 0, 状态: '不适用' };
                }
                const ok = hits > 0;
                return { 检查项: r.name, 选择器: r.sel, 命中: hits, 状态: ok ? 'OK' : (r.required ? '缺失(必需)' : '缺失(可选)') };
            });

            // 公式识别功能校验：抽样前 30 张 img，确认 isFormulaSvgImage 仍能识别
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
            // 保证 layoutPreset 始终是已知预设键：脏值/空串（旧迁移残留、误写）一律回退到默认 'compact'，
            // 避免首屏出现「实际是紧凑版式、UI 却显示自定义」的状态不一致。
            if (!LAYOUT_PRESETS[result.layoutPreset]) result.layoutPreset = 'compact';
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
                    default: GM_setValue(s.storage, val);
                }
            }
        }

        async openPreviewWithSettings(overrides = {}) {
            try {
                // 重新打开新卷时清空公式基准缓存，避免不同试卷间共享公式 src 导致基准串味
                resetFormulaBaseCache();
                const settings = this.getPreviewSettings(overrides);
                this.savePreviewSettings(settings);
                const flags = settings.contentFlags || ['q'];
                const includeQuestions = flags.includes('q');
                const includeKnowledge = flags.includes('kp');
                const includeAnswers = flags.includes('a');
                const answersAtEnd = Boolean(settings.answersAtEnd);
                const needAnswers = includeAnswers || answersAtEnd;

                // [E3.1] 空试卷保护：当前页面未识别到任何题目时提示，避免静默生成空白预览
                if (!document.querySelector('.sec-title, .questype-head .questypetitle, .tk-quest-item.quesroot')) {
                    const msg = '当前页面未识别到题目，无法生成预览。请确认已在组卷网打开一份试卷。';
                    if (typeof GM_notification === 'function') GM_notification({ text: msg, title: '组卷打印助手' });
                    else alert(msg);
                    return;
                }

                const baseOpts = {
                    includeQ: includeQuestions, includeKP: includeKnowledge, includeA: false, atEnd: false,
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
            const cb = document.querySelector(ANSWER_SWITCH_SEL);
            if (cb) return cb.checked === true;
            // 无显式答案开关时，退而判断答案区块是否已渲染实质内容（图片/矢量）
            return !!document.querySelector('.exam-item__opt .item.answer img, .exam-item__opt .item.answer svg');
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

        removeLeadingNumber(container) {
            // 题号位置规则（按页面类型）：先执行「元素删除」类规则，再执行「文本节点剥离」类规则（命中首个即停）。
            // 组卷中心等页面把题号放在独立 .quesindex 元素里（如 <span class="quesindex">1．</span>）；
            // 其余页面（试卷/章节/知识点）题号是文本节点开头的 "1." / "1 ." / 全角 "1．"，直接剥离。
            const LEADING_NUMBER_RULES = [
                { type: 'element', sel: '.quesindex' },
                { type: 'text', pattern: /^\s*\d+\s*[.\uFF0E]\s*/ },
            ];
            for (const rule of LEADING_NUMBER_RULES) {
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

        preparePreviewTypography(root) {
            // 实时 DOM 中已布局的公式图（用于首渲冻结其真实尺寸）。只扫描题目容器，避免整页（含广告/头像）大数组分配，
            // 也更贴合 rootFormulas 的来源（题目体来自 .wrapper.quesdiv），降低下标错位风险。
            const liveFormulas = Array.from(document.querySelectorAll('.wrapper.quesdiv img')).filter(img => this.isFormulaSvgImage(img));
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
                        return parent.closest('script, style, svg, math, mjx-container, .MathJax, .katex, code, pre, .zh-latin-gap')
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
            const answerRowHeight = Math.max(1, Math.min(6, Number(layoutOptions.answerRowHeight) || 1.8));
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

            // 章节标题提取器注册表：新增页面类型只需追加一项 { sel, get }，无需改下方题目大分支。
            // .sec-title 为试卷详情页（取内部 span）；.questypetitle 为组卷中心左标题区（拼 index+name）；
            // 右侧「分组与排序」面板（.ques-type h3）属编辑视图，不取。
            const SECTION_TITLE_EXTRACTORS = [
                { sel: '.sec-title', get: n => { const s = n.querySelector('span'); return s ? s.textContent.trim() : ''; } },
                { sel: '.questypetitle', get: n => {
                    const idx = n.querySelector('.questypeindex');
                    const name = n.querySelector('.questypename');
                    return ((idx ? idx.textContent : '') + (name ? name.textContent : '')).trim();
                } },
            ];
            document.querySelectorAll('.sec-title, .questype-head .questypetitle, .tk-quest-item.quesroot').forEach(node => {
                for (const ex of SECTION_TITLE_EXTRACTORS) {
                    if (node.matches(ex.sel)) {
                        const t = ex.get(node);
                        if (t) appendSection(t);
                        return; // 命中标题提取器，不再走题目分支
                    }
                }

                const wrap = node.querySelector('.wrapper.quesdiv');
                if (!wrap) return;

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

                if (includeQ) {
                    const cnt = wrap.querySelector('.exam-item__cnt');
                    if (cnt) {
                        const cntClone = cnt.cloneNode(true);
                        this.removeLeadingNumber(cntClone);
                        const questionLayout = document.createElement('div');
                        questionLayout.className = 'zujuanjs-question-layout';
                        const numSpan = document.createElement('span');
                        numSpan.className = 'zujuanjs-question-number';
                        numSpan.textContent = `${questionIndex}.`;
                        questionBody = document.createElement('div');
                        questionBody.className = 'zujuanjs-question-body';
                        questionBody.appendChild(cntClone);

                        // 知识点提取（紧跟题干）
                        if (includeKP) {
                            const kpBox = this.extractKnowledgePoints(wrap, font, size);
                            if (kpBox) questionBody.appendChild(kpBox);
                        }

                        questionLayout.appendChild(numSpan);
                        questionLayout.appendChild(questionBody);
                        qDiv.appendChild(questionLayout);
                    }
                } else if (includeKP) {
                    // 不选试题但选知识点时，仍需创建容器来放知识点
                    questionBody = document.createElement('div');
                    questionBody.className = 'zujuanjs-question-body';
                    const kpBox = this.extractKnowledgePoints(wrap, font, size);
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

                const cachedOpt = this._getCachedAnswerClone(wrap);
                const opt = cachedOpt || wrap.querySelector('.exam-item__opt');
                if (opt) {
                    const optClone = opt.cloneNode(true);
                    // 仅在答案区已就绪时才缓存（避免缓存未展开时的空壳，否则用户后续手动展开答案、
                    // 重新打开预览时仍复用空壳，导致答案始终为空）。未就绪则每次重读实时 DOM。
                    if (!cachedOpt) {
                        const ansNode = optClone.querySelector('.item.answer');
                        const ansReady = ansNode && (ansNode.querySelector('img, svg, canvas, table')
                            || ansNode.textContent.replace(/\s/g, '').length > 2);
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
                        const ansPart = optClone.querySelector('.item.answer');
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

                        // 答案为空（无实质文本或图片）则跳过，不保留空题号
                        const hasRealContent = answerWrap.querySelector('img, svg, canvas, table')
                            || answerWrap.textContent.replace(/\s/g, '').length > 2;
                        if (!hasRealContent) { /* 空：不加入列表 */ } else {
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
                        }
                    } else if (includeA) {
                        // 勾选了答案（且未附末尾），整段放入（答案块）
                        (questionBody || qDiv).appendChild(optClone);
                    }
                }

                qWrapper.appendChild(qDiv);
                tempDiv.appendChild(qWrapper);
                questionIndex++;
            });

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
            return {
                html: tempDiv.innerHTML,
                font, size, lineHeight, title, titleSize, pageFont, pageSize, pageBold,
                showPageNumber, marginTop, marginRight, marginBottom, marginLeft,
                questionSpacing, previewLayout, previewZoom, paragraphSpacing, contentAlign,
                numberGap, answerRowHeight, pageGap, editorPanelWidth, editorPanelTab,
                editorOpen, documentEdits, readingAnchor, contentFlags, answersAtEnd,
                contentWidth, contentHeight, footerBottom
            };
        }

        generatePreviewHTML(opts = {}) {
            const src = this.generateSourceContentHTML(opts);
            const { html: contentHtml, font, size, lineHeight, title, titleSize, pageFont, pageSize, pageBold, showPageNumber, marginTop, marginRight, marginBottom, marginLeft, questionSpacing, previewLayout, previewZoom, paragraphSpacing, contentAlign, numberGap, answerRowHeight, pageGap, editorPanelWidth, editorPanelTab, editorOpen, documentEdits, readingAnchor, contentFlags, answersAtEnd, contentWidth, contentHeight, footerBottom } = src;
            const previewSettingsJson = JSON.stringify({
                mode: 'q', font, size, lineHeight, title, titleSize: `${titleSize}px`,
                pageFont, pageSize, pageBold, showPageNumber, pageMargins: `${marginTop},${marginRight},${marginBottom},${marginLeft}`,
                questionSpacing: String(questionSpacing), previewLayout, previewZoom,
                paragraphSpacing: String(paragraphSpacing), contentAlign, numberGap: String(numberGap),
                answerRowHeight: String(answerRowHeight), pageGap: String(pageGap),
                editorPanelWidth: String(editorPanelWidth), editorPanelTab, editorOpen, documentEdits, readingAnchor,
                layoutPreset: (opts.layoutOptions && opts.layoutOptions.layoutPreset) || 'compact',
                contentFlags, answersAtEnd,
                autoCheckIn: GM_getValue('zujuanjsAutoCheckIn', false) === true,
                selfCheck: GM_getValue('zujuanjsSelfCheck', false) === true,
                layoutPresets: LAYOUT_PRESETS,
                token: PREVIEW_TOKEN
            }).replace(/</g, '\\u003c');
            const fontWeight = pageBold ? 'bold' : 'normal';

            // 由内容块注册表驱动生成「打印内容」复选框（试题锁定置灰，其余可选）
            const contentCheckboxesHtml = CONTENT_BLOCKS.map(b => {
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
                    .answer-blank { height: 2.5em; }
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

                    .zujuanjs-section-title { font-size: 1.25em; font-weight: bold; margin: 22px 0 12px; border-left: 4px solid #000; padding-left: 8px; page-break-inside: avoid; page-break-after: avoid; }
                    /* 参考答案标题：强制从新页开始（打印模式） */
                    .zujuanjs-answers-header { break-before: page; page-break-before: always; border-left: none; }
                    .zujuanjs-print-title { font-size: var(--title-size, 24px); text-align: center; font-weight: bold; margin: 15px 0 30px; line-height: 1.4; page-break-inside: avoid; }
                    .zujuanjs-question { margin-bottom: 18px; padding: 4px 0; border-bottom: none; }
                    .zujuanjs-question-number { font-weight: bold; white-space: pre; }
                    .zujuanjs-answer-item { margin-bottom: 18px; padding: 4px 0; border: none; }
                    .zujuanjs-answer-title { font-weight: bold; margin-bottom: 6px; }
                    .zujuanjs-knowledge-points { font-size: 0.9em; color: #555; line-height: 1.6; }
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
                        grid-template-columns: max-content minmax(0, 1fr);
                        column-gap: 0.55em;
                        align-items: start;
                        width: 100%;
                        min-width: 0;
                    }
                    .zujuanjs-question-number {
                        grid-column: 1;
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
                        color: var(--text-secondary, #888);
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
                        --answer-row-height: ${answerRowHeight}em;
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
                        height: var(--answer-row-height);
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
                                                <span style="width:1px;height:14px;background:#ddd;margin:0 2px;"></span>
                                                <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:#434343;"><input type="checkbox" id="setting-answers-at-end" style="accent-color:#1677ff;width:14px;height:14px;">答案附末尾</label>
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
                                        <label class="editor-field editor-field-unit">段间距<input class="form-control form-control-sm" id="setting-paragraph-spacing" type="number" min="0" max="24" step="1"><span>px</span></label>
                                        <label class="editor-field">对齐<select class="form-select form-select-sm" id="setting-align"><option value="left">左对齐</option><option value="justify">两端对齐</option></select></label>
                                        <label class="editor-field editor-field-unit wide">题号间距<input class="form-control form-control-sm" id="setting-number-gap" type="number" min="0.2" max="2" step="0.05"><span>em</span></label>
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
                                        <label class="editor-field editor-field-unit">答题行高<input class="form-control form-control-sm" id="setting-answer-row-height" type="number" min="1" max="6" step="0.1"><span>em</span></label>
                                        <label class="editor-field editor-field-unit">页面间距<input class="form-control form-control-sm" id="setting-page-gap" type="number" min="8" max="48" step="1"><span>px</span></label>
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
                    // 版式预设来自父窗口注入的单一来源（LAYOUT_PRESETS），与脚本定义保持一致
                    const layoutPresets = previewSettings.layoutPresets;
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

                    function setSaveStatus(message) {
                        if (editorSaveStatus) editorSaveStatus.textContent = message;
                    }

                    function updateLayoutPresetUI() {
                        // 以用户当前选择的版式为准；脏值/空串回退到默认 'compact'（与父窗口归一逻辑一致）
                        const requested = layoutPresets[previewSettings.layoutPreset] ? previewSettings.layoutPreset : 'compact';
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

                    function applyBlockEditsToSource() {
                        Array.from(sourceContent.children)
                            .filter(element => element.classList.contains('page-break'))
                            .forEach(element => element.remove());
                        sourceContent.querySelectorAll('.q-wrapper > .answer-blank, .q-wrapper > .answer-blank-large')
                            .forEach(element => element.remove());
                        const wrappers = Array.from(sourceContent.children).filter(element => element.classList.contains('q-wrapper'));

                        wrappers.forEach(wrapper => {
                            const state = getBlockEdit(wrapper.dataset.blockId);
                            wrapper.dataset.extraLines = String(state.extraLines);
                            for (let index = 0; index < state.extraLines; index++) {
                                const blank = document.createElement('div');
                                blank.className = 'answer-blank';
                                blank.dataset.lineIndex = String(index + 1);
                                blank.setAttribute('aria-hidden', 'true');
                                wrapper.appendChild(blank);
                            }
                        });

                        wrappers.forEach(wrapper => {
                            const state = getBlockEdit(wrapper.dataset.blockId);
                            if (state.breakBefore && !wrapper.previousElementSibling?.classList.contains('page-break')) {
                                const marker = document.createElement('div');
                                marker.className = 'page-break';
                                marker.dataset.ownerBlockId = wrapper.dataset.blockId;
                                marker.dataset.breakSide = 'before';
                                wrapper.parentNode.insertBefore(marker, wrapper);
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
                        document.getElementById('setting-paragraph-spacing').value = previewSettings.paragraphSpacing;
                        setSelectValue('setting-align', previewSettings.contentAlign);
                        document.getElementById('setting-number-gap').value = previewSettings.numberGap;
                        ['top', 'right', 'bottom', 'left'].forEach((side, index) => {
                            document.getElementById('setting-margin-' + side).value = margins[index] || 15;
                        });
                        document.getElementById('setting-answer-row-height').value = previewSettings.answerRowHeight;
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
                            paragraphSpacing: String(clamp(document.getElementById('setting-paragraph-spacing').value, 0, 24, 8)),
                            contentAlign: document.getElementById('setting-align').value === 'justify' ? 'justify' : 'left',
                            numberGap: String(clamp(document.getElementById('setting-number-gap').value, 0.2, 2, 0.55)),
                            pageMargins: [margin('top'), margin('right'), margin('bottom'), margin('left')].join(','),
                            layoutPreset: layoutPresets[previewSettings.layoutPreset] ? previewSettings.layoutPreset : 'custom',
                            answerRowHeight: String(clamp(document.getElementById('setting-answer-row-height').value, 1, 6, 1.8)),
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

                    function applyLayoutPreset(name) {
                        const preset = layoutPresets[name];
                        if (!preset) return;
                        Object.assign(previewSettings, preset.settings, { layoutPreset: name });
                        currentLayout = previewSettings.previewLayout;
                        currentZoom = previewSettings.previewZoom;
                        writeSettingsToEditor();
                        applyDocumentStyles();
                        applyPreviewView();
                        scheduleRender();
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
                        root.style.setProperty('--answer-row-height', clamp(previewSettings.answerRowHeight, 1, 6, 1.8) + 'em');
                        root.style.setProperty('--page-gap', clamp(previewSettings.pageGap, 8, 48, 20) + 'px');
                        root.style.setProperty('--content-align', previewSettings.contentAlign === 'justify' ? 'justify' : 'left');

                        const title = sourceContent.querySelector('[data-document-title]');
                        if (title) {
                            title.textContent = previewSettings.title || '';
                            title.style.display = previewSettings.title ? '' : 'none';
                            title.style.fontFamily = previewSettings.font;
                            title.style.fontSize = Math.max(18, Math.min(36, parseFloat(previewSettings.titleSize) || 24)) + 'px';
                        }
                        sourceContent.querySelectorAll('.zujuanjs-question, .zujuanjs-answer-item').forEach(element => {
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
                            // 题目的段后距可以落在页边距中；只按真实文字行和不可拆元素判定溢出。
                            return !!findOverflowBoundary(node, pageBottom);
                        }
                        return node.getBoundingClientRect().bottom > pageBottom + overflowTolerance;
                    }

                    function boundaryBefore(element) {
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

                    function findOverflowBoundary(root, pageBottom) {
                        const atomicSelector = 'img, table, svg, canvas, pre, br, mjx-container, .MathJax, .katex, .answer-blank, .answer-blank-large';

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
                                    return boundaryBefore(child);
                                }
                                if (child.matches(atomicSelector)) {
                                    if (rect.bottom > pageBottom + overflowTolerance) return boundaryBefore(child);
                                    continue;
                                }

                                const nestedBoundary = visit(child);
                                if (nestedBoundary) return nestedBoundary;

                                // 兼容没有文字节点、但自身有高度的站点组件：
                                // 如公式 SVG、视频/音频占位、空 div 等（组卷网部分组件渲染后占高但无文本）。
                                // 若其底部越过页底，则当作分页边界处理，避免整块被硬塞在上一页溢出。
                                if (rect.bottom > pageBottom + overflowTolerance && !child.textContent.trim()) {
                                    return boundaryBefore(child);
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
                            if (!nodeOverflowsPage(node, page.content)) {
                                // 章节标题 keep-with-next：标题本身放得下，但若紧随的题目放不下，
                                // 则把标题也推到下一页，避免「标题孤悬底部、题目跑到下页」。
                                if (node.classList.contains('zujuanjs-section-title') && pageAlreadyHasContent && queue.length > 0) {
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
                                split = splitQuestionAt(node, findOverflowBoundary(node, pageBottom));
                            }

                            if (split) {
                                node.remove();
                                page.content.appendChild(split.first);
                                if (!nodeOverflowsPage(split.first, page.content)) {
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

                        const papers = Array.from(paperContainer.querySelectorAll('.paper'));
                        for (let i = papers.length - 1; i > 0; i--) {
                            const content = papers[i].querySelector('.paper-content');
                            if (pageHasContent(content)) break;
                            papers[i].closest('.paper-shell')?.remove();
                        }

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
                    document.getElementById('editor-reset').addEventListener('click', () => {
                        applyLayoutPreset('compact');
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
