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
        fontMode: 'original',
        customFontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif',
        adSelectors: ['.aside-pop.activity-btn', '.ai-entry.fixed'],
    };

    // ==========================================
    // 全局样式
    // ==========================================
    GM_addStyle(`
        .zujuanjs-float-print-btn {
            position: fixed !important; bottom: 30px !important; right: 30px !important;
            width: 56px !important; height: 56px !important; border-radius: 50% !important;
            background: #1677ff !important; color: #fff !important; border: none !important;
            box-shadow: 0 4px 14px rgba(22, 119, 255, 0.4) !important; cursor: pointer !important;
            z-index: 99999 !important; display: flex !important; align-items: center !important;
            justify-content: center !important; transition: all 0.3s ease !important; font-size: 22px !important;
        }
        .zujuanjs-float-print-btn:hover { background: #4096ff !important; box-shadow: 0 6px 20px rgba(22, 119, 255, 0.5) !important; transform: translateY(-2px) !important; }
        .zujuanjs-float-print-btn:active { transform: translateY(0) !important; box-shadow: 0 2px 8px rgba(22, 119, 255, 0.3) !important; }
        .zujuanjs-float-print-btn-text { display: none; }
        @media (min-width: 768px) {
            .zujuanjs-float-print-btn { width: auto !important; height: auto !important; border-radius: 28px !important; padding: 12px 24px !important; font-size: 15px !important; font-weight: 500 !important; letter-spacing: 0 !important; }
            .zujuanjs-float-print-btn-icon { margin-right: 6px; }
            .zujuanjs-float-print-btn-text { display: inline; }
        }

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
        }
        #zujuanjs-preview-overlay iframe { width: 100%; height: 100%; border: none; }
    `);

    class PaperPrinter {
        constructor() { this.init(); }

        init() {
            this.applyFont();
            this.autoCheckIn();
            this.createFloatingButton();
            if (document.body) this.startAdRemover();
            else document.addEventListener('DOMContentLoaded', () => this.startAdRemover());

            window.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'closeZujuanPreview') {
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
                        GM_setValue('editorOpen', e.data.value === 'true');
                    }
                } else if (e.data && e.data.type === 'saveZujuanPrintSettings') {
                    this.savePreviewSettings(e.data.settings);
                } else if (e.data && e.data.type === 'rebuildZujuanPreview') {
                    this.openPreviewWithSettings(e.data.settings);
                }
            });
        }

        applyFont() {
            if (Config.fontMode === 'custom') GM_addStyle(`body, * { font-family: ${Config.customFontFamily} !important; }`);
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
            setTimeout(() => {
                const signedInLink = document.querySelector('.user-assets-box a.assets-method[href="/score_task/"]');
                if (signedInLink && signedInLink.textContent.trim() !== '已签到') {
                    document.querySelector('a.sign-in-btn')?.click();
                    document.querySelector('a.day-sign-in')?.click();
                }
            }, 2500);
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
            const observer = new MutationObserver(() => {
                Config.adSelectors.forEach(sel => document.querySelector(sel)?.remove());
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        getFontOptions() {
            return [
                { value: '"Times New Roman", SimSun, "Songti SC", serif', text: '宋体 + 新罗马' },
                { value: 'SimSun, "Songti SC", serif', text: '宋体' },
                { value: '"Microsoft YaHei", "PingFang SC", sans-serif', text: '微软雅黑' },
                { value: 'SimHei, "PingFang SC", sans-serif', text: '黑体' },
                { value: 'KaiTi, "Songti SC", serif', text: '楷体' },
                { value: 'FangSong, "Songti SC", serif', text: '仿宋' },
                { value: '"Noto Serif SC", "Times New Roman", serif', text: '思源宋体' },
                { value: '"Noto Sans SC", "PingFang SC", sans-serif', text: '思源黑体' }
            ];
        }

        getSizeOptions() {
            return [
                { value: '14px', text: '14px' }, { value: '15px', text: '15px' },
                { value: '16px', text: '16px' }, { value: '17px', text: '17px' },
                { value: '18px', text: '18px' }, { value: '20px', text: '20px' }, { value: '22px', text: '22px' }
            ];
        }

        getLineHeightOptions() {
            return [
                { value: '1.2', text: '1.2 · 紧凑' }, { value: '1.35', text: '1.35' },
                { value: '1.5', text: '1.5 · 标准' }, { value: '1.75', text: '1.75' }, { value: '2.0', text: '2.0 · 宽松' }
            ];
        }

        getPageSizeOptions() {
            return [
                { value: '10px', text: '10px' }, { value: '12px', text: '12px' },
                { value: '14px', text: '14px' }, { value: '16px', text: '16px' }, { value: '18px', text: '18px' }
            ];
        }

        getBoldOptions() {
            return [{ value: 'false', text: '不加粗' }, { value: 'true', text: '加粗' }];
        }

        escapeAttribute(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        renderSelect(id, options, defaultValue) {
            let allOptions = options.slice();
            const exists = allOptions.some(o => o.value === defaultValue);
            if (!exists && defaultValue !== undefined && defaultValue !== '') {
                allOptions.unshift({ value: defaultValue, text: '自定义' });
            }
            const selected = allOptions.find(o => o.value === defaultValue) || allOptions[0];
            const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const optsHtml = allOptions.map(o =>
                `<div class="print-custom-select-option${o.value === selected.value ? ' selected' : ''}" data-value="${escapeAttr(o.value)}">${o.text}</div>`
            ).join('');
            return `
                <div class="print-custom-select" id="${id}" data-value="${escapeAttr(selected.value)}">
                    <div class="print-custom-select-trigger"><span>${selected.text}</span><div class="print-custom-select-arrow"></div></div>
                    <div class="print-custom-select-dropdown">${optsHtml}</div>
                </div>`;
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

        showPrintDialogLegacy() {
            const savedFont = GM_getValue('questionFont', '"Times New Roman", SimSun, "Songti SC", serif');
            const savedSize = GM_getValue('questionSize', '16px');
            const savedLineHeight = GM_getValue('questionLineHeight', '1.5');
            const savedPageFont = GM_getValue('pageFont', savedFont);
            const savedPageSize = GM_getValue('pageSize', '12px');
            const savedPageBold = String(GM_getValue('pageBold', true));
            const savedMode = GM_getValue('printMode', 'q');
            const savedMargins = GM_getValue('pageMargins', '18,15,22,15');
            const savedQuestionSpacing = String(GM_getValue('questionSpacing', '10'));
            const savedPreviewLayout = GM_getValue('previewLayout', 'double');
            const savedPreviewZoom = String(GM_getValue('previewZoom', 'auto'));
            const defaultTitle = this.getPaperTitle();

            const fontOptions = this.getFontOptions();
            const sizeOptions = this.getSizeOptions();
            const lineHeightOptions = this.getLineHeightOptions();
            const pageSizeOptions = this.getPageSizeOptions();
            const boldOptions = this.getBoldOptions();

            const modeOptions = [
                { value: 'q', text: '仅试题' },
                { value: 'qa', text: '试题与答案' },
                { value: 'qe', text: '答案附末尾' },
                { value: 'a', text: '仅答案' }
            ];
            const marginOptions = [
                { value: '12,12,18,12', text: '紧凑' },
                { value: '18,15,22,15', text: '标准' },
                { value: '22,18,26,18', text: '宽松' }
            ];
            const spacingOptions = [
                { value: '4', text: '4px 紧凑' },
                { value: '10', text: '10px 标准' },
                { value: '16', text: '16px' },
                { value: '22', text: '22px 宽松' }
            ];
            const zoomOptions = [
                { value: 'auto', text: '自动适应' },
                { value: '0.65', text: '65%' },
                { value: '0.8', text: '80%' },
                { value: '1', text: '100%' }
            ];

            const closeAllSelects = (e) => {
                if (!e.target.closest('.print-custom-select')) {
                    document.querySelectorAll('.print-custom-select.open').forEach(s => s.classList.remove('open'));
                }
            };

            Swal.fire({
                title: '打印设置',
                width: 700,
                customClass: { popup: 'print-dialog-popup' },
                confirmButtonColor: '#1677ff',
                cancelButtonColor: '#d9d9d9',
                html: `
                    <div class="print-dialog-container">
                        <div class="print-dialog-section">
                            <label class="print-dialog-label">试卷标题</label>
                            <input type="text" id="print-title-input" class="print-dialog-input" value="${this.escapeAttribute(defaultTitle)}" placeholder="留空则不显示标题">
                        </div>

                        <div class="print-dialog-section">
                            <label class="print-dialog-label">打印内容</label>
                            <div class="print-option-grid" id="print-mode-grid">
                                ${modeOptions.map(m => `
                                    <label class="print-option-card${m.value === savedMode ? ' active' : ''}">
                                        <input type="radio" name="printMode" value="${m.value}" ${m.value === savedMode ? 'checked' : ''}>
                                        <span>${m.text}</span>
                                    </label>`).join('')}
                            </div>
                        </div>

                        <div class="print-dialog-section">
                            <label class="print-dialog-label">正文样式</label>
                            <div class="print-row-3">
                                <div class="print-field">
                                    <div class="print-field-label">字体</div>
                                    ${this.renderSelect('print-font-select', fontOptions, savedFont)}
                                </div>
                                <div class="print-field">
                                    <div class="print-field-label">字号</div>
                                    ${this.renderSelect('print-size-select', sizeOptions, savedSize)}
                                </div>
                                <div class="print-field">
                                    <div class="print-field-label">行距</div>
                                    ${this.renderSelect('print-lineheight-select', lineHeightOptions, savedLineHeight)}
                                </div>
                            </div>
                        </div>

                        <div class="print-dialog-section">
                            <label class="print-dialog-label">页面排版</label>
                            <div class="print-row-4">
                                <div class="print-field">
                                    <div class="print-field-label">预览排布</div>
                                    <div class="print-option-grid print-layout-grid" id="print-layout-grid">
                                        <label class="print-option-card${savedPreviewLayout === 'single' ? ' active' : ''}">
                                            <input type="radio" name="previewLayout" value="single" ${savedPreviewLayout === 'single' ? 'checked' : ''}>
                                            <span>单页</span>
                                        </label>
                                        <label class="print-option-card${savedPreviewLayout === 'double' ? ' active' : ''}">
                                            <input type="radio" name="previewLayout" value="double" ${savedPreviewLayout === 'double' ? 'checked' : ''}>
                                            <span>双页</span>
                                        </label>
                                    </div>
                                </div>
                                <div class="print-field">
                                    <div class="print-field-label">预览缩放</div>
                                    ${this.renderSelect('print-zoom-select', zoomOptions, savedPreviewZoom)}
                                </div>
                                <div class="print-field">
                                    <div class="print-field-label">页边距</div>
                                    ${this.renderSelect('print-margin-select', marginOptions, savedMargins)}
                                </div>
                                <div class="print-field">
                                    <div class="print-field-label">题间距</div>
                                    ${this.renderSelect('print-spacing-select', spacingOptions, savedQuestionSpacing)}
                                </div>
                            </div>
                        </div>

                        <div class="print-dialog-section">
                            <label class="print-dialog-label">页码样式</label>
                            <div class="print-row-3">
                                <div class="print-field">
                                    <div class="print-field-label">字体</div>
                                    ${this.renderSelect('print-pagefont-select', fontOptions, savedPageFont)}
                                </div>
                                <div class="print-field">
                                    <div class="print-field-label">字号</div>
                                    ${this.renderSelect('print-pagesize-select', pageSizeOptions, savedPageSize)}
                                </div>
                                <div class="print-field">
                                    <div class="print-field-label">字重</div>
                                    ${this.renderSelect('print-pagebold-select', boldOptions, savedPageBold)}
                                </div>
                            </div>
                        </div>

                        <div class="print-dialog-section">
                            <div class="print-preview-wrap">
                                <span class="print-preview-caption">样例</span>
                                <div class="print-preview-box" id="print-preview">
                                    1.&emsp;已知函数 f(x) = ax² + bx + c (a ≠ 0)，在区间 [1, 5] 上单调递增。
                                </div>
                            </div>
                        </div>
                    </div>`,
                confirmButtonText: '进入A4预览',
                showCancelButton: true,
                cancelButtonText: '取消',
                didOpen: () => {
                    const preview = document.getElementById('print-preview');
                    const updatePreview = () => {
                        const fontSelect = document.getElementById('print-font-select');
                        const sizeSelect = document.getElementById('print-size-select');
                        const lhSelect = document.getElementById('print-lineheight-select');
                        const font = fontSelect ? fontSelect.dataset.value : savedFont;
                        const size = sizeSelect ? sizeSelect.dataset.value : savedSize;
                        const lh = lhSelect ? lhSelect.dataset.value : savedLineHeight;
                        preview.style.fontFamily = font;
                        preview.style.fontSize = size;
                        preview.style.lineHeight = lh;
                    };

                    this.initSelect('print-font-select', () => updatePreview());
                    this.initSelect('print-size-select', () => updatePreview());
                    this.initSelect('print-lineheight-select', () => updatePreview());
                    this.initSelect('print-pagefont-select');
                    this.initSelect('print-pagesize-select');
                    this.initSelect('print-pagebold-select');
                    this.initSelect('print-zoom-select');
                    this.initSelect('print-margin-select');
                    this.initSelect('print-spacing-select');

                    ['print-mode-grid', 'print-layout-grid'].forEach(gridId => {
                        const grid = document.getElementById(gridId);
                        grid?.querySelectorAll('.print-option-card').forEach(card => {
                            card.addEventListener('click', () => {
                                grid.querySelectorAll('.print-option-card').forEach(c => c.classList.remove('active'));
                                card.classList.add('active');
                            });
                        });
                    });

                    document.addEventListener('click', closeAllSelects);
                    updatePreview();
                },
                willClose: () => {
                    document.removeEventListener('click', closeAllSelects);
                },
                preConfirm: () => ({
                    mode: document.querySelector('input[name="printMode"]:checked')?.value || 'q',
                    font: document.getElementById('print-font-select')?.dataset.value || savedFont,
                    size: document.getElementById('print-size-select')?.dataset.value || savedSize,
                    lineHeight: document.getElementById('print-lineheight-select')?.dataset.value || savedLineHeight,
                    title: document.getElementById('print-title-input').value.trim(),
                    pageFont: document.getElementById('print-pagefont-select')?.dataset.value || savedPageFont,
                    pageSize: document.getElementById('print-pagesize-select')?.dataset.value || savedPageSize,
                    pageBold: document.getElementById('print-pagebold-select')?.dataset.value === 'true',
                    pageMargins: document.getElementById('print-margin-select')?.dataset.value || savedMargins,
                    questionSpacing: document.getElementById('print-spacing-select')?.dataset.value || savedQuestionSpacing,
                    previewLayout: document.querySelector('input[name="previewLayout"]:checked')?.value || savedPreviewLayout,
                    previewZoom: document.getElementById('print-zoom-select')?.dataset.value || savedPreviewZoom
                })
            }).then(async res => {
                if (!res.isConfirmed) return;
                const { mode, font, size, lineHeight, title, pageFont, pageSize, pageBold, pageMargins, questionSpacing, previewLayout, previewZoom } = res.value;
                GM_setValue('questionFont', font);
                GM_setValue('questionSize', size);
                GM_setValue('questionLineHeight', lineHeight);
                GM_setValue('pageFont', pageFont || font);
                GM_setValue('pageSize', pageSize || '12px');
                GM_setValue('pageBold', pageBold);
                GM_setValue('printMode', mode);
                GM_setValue('pageMargins', pageMargins);
                GM_setValue('questionSpacing', questionSpacing);
                GM_setValue('previewLayout', previewLayout);
                GM_setValue('previewZoom', previewZoom);

                const includeQuestions = mode !== 'a';
                const includeAnswers = mode === 'qa' || mode === 'a';
                const answersAtEnd = mode === 'qe';

                if (includeAnswers || answersAtEnd) {
                    Swal.fire({ title: '请稍候', text: '正在准备答案解析...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    this.triggerShowAnswers();
                    await this.waitForImages();
                    Swal.close();
                }

                const htmlContent = this.generatePreviewHTML(
                    includeQuestions,
                    includeAnswers,
                    answersAtEnd,
                    font,
                    size,
                    lineHeight,
                    title,
                    pageFont || font,
                    pageSize || '12px',
                    pageBold,
                    { pageMargins, questionSpacing, previewLayout, previewZoom }
                );
                this.openPreview(htmlContent);
            });
        }

        getPreviewSettings(overrides = {}) {
            const has = key => Object.prototype.hasOwnProperty.call(overrides, key);
            const font = has('font') ? overrides.font : GM_getValue('questionFont', '"Times New Roman", SimSun, "Songti SC", serif');
            return {
                mode: has('mode') ? overrides.mode : GM_getValue('printMode', 'q'),
                font,
                size: has('size') ? overrides.size : GM_getValue('questionSize', '16px'),
                lineHeight: has('lineHeight') ? overrides.lineHeight : GM_getValue('questionLineHeight', '1.5'),
                title: has('title') ? overrides.title : this.getPaperTitle(),
                titleSize: has('titleSize') ? overrides.titleSize : GM_getValue('titleSize', '24px'),
                pageFont: has('pageFont') ? overrides.pageFont : GM_getValue('pageFont', font),
                pageSize: has('pageSize') ? overrides.pageSize : GM_getValue('pageSize', '12px'),
                pageBold: has('pageBold') ? String(overrides.pageBold) !== 'false' : String(GM_getValue('pageBold', true)) !== 'false',
                showPageNumber: has('showPageNumber') ? Boolean(overrides.showPageNumber) : Boolean(GM_getValue('showPageNumber', true)),
                pageMargins: has('pageMargins') ? overrides.pageMargins : GM_getValue('pageMargins', '18,15,22,15'),
                layoutPreset: has('layoutPreset') ? overrides.layoutPreset : GM_getValue('layoutPreset', 'exam'),
                questionSpacing: has('questionSpacing') ? overrides.questionSpacing : GM_getValue('questionSpacing', '10'),
                previewLayout: has('previewLayout') ? overrides.previewLayout : GM_getValue('previewLayout', 'double'),
                previewZoom: has('previewZoom') ? overrides.previewZoom : GM_getValue('previewZoom', 'auto'),
                paragraphSpacing: has('paragraphSpacing') ? overrides.paragraphSpacing : GM_getValue('paragraphSpacing', '8'),
                contentAlign: has('contentAlign') ? overrides.contentAlign : GM_getValue('contentAlign', 'left'),
                numberGap: has('numberGap') ? overrides.numberGap : GM_getValue('numberGap', '0.55'),
                answerRowHeight: has('answerRowHeight') ? overrides.answerRowHeight : GM_getValue('answerRowHeight', '1.8'),
                pageGap: has('pageGap') ? overrides.pageGap : GM_getValue('pageGap', '20'),
                editorPanelWidth: has('editorPanelWidth') ? overrides.editorPanelWidth : GM_getValue('editorPanelWidth', '340'),
                editorPanelTab: has('editorPanelTab') ? overrides.editorPanelTab : GM_getValue('editorPanelTab', 'document'),
                editorOpen: has('editorOpen') ? Boolean(overrides.editorOpen) : String(GM_getValue('editorOpen', true)) !== 'false',
                documentEdits: has('documentEdits') && overrides.documentEdits && typeof overrides.documentEdits === 'object'
                    ? overrides.documentEdits
                    : {},
                readingAnchor: has('readingAnchor') && overrides.readingAnchor && typeof overrides.readingAnchor === 'object'
                    ? overrides.readingAnchor
                    : null
            };
        }

        savePreviewSettings(settings = {}) {
            const allowed = [
                'mode', 'font', 'size', 'lineHeight', 'titleSize', 'pageFont', 'pageSize', 'pageBold',
                'showPageNumber', 'pageMargins', 'layoutPreset', 'questionSpacing', 'previewLayout', 'previewZoom',
                'paragraphSpacing', 'contentAlign', 'numberGap', 'answerRowHeight', 'pageGap',
                'editorPanelWidth', 'editorPanelTab', 'editorOpen'
            ];
            allowed.forEach(key => {
                if (!Object.prototype.hasOwnProperty.call(settings, key)) return;
                GM_setValue(key === 'mode' ? 'printMode' : key, settings[key]);
            });
        }

        async openPreviewWithSettings(overrides = {}) {
            const settings = this.getPreviewSettings(overrides);
            this.savePreviewSettings(settings);
            const includeQuestions = settings.mode !== 'a';
            const includeAnswers = settings.mode === 'qa' || settings.mode === 'a';
            const answersAtEnd = settings.mode === 'qe';

            if (includeAnswers || answersAtEnd) {
                this.triggerShowAnswers();
                await this.waitForImages();
            }

            const htmlContent = this.generatePreviewHTML(
                includeQuestions,
                includeAnswers,
                answersAtEnd,
                settings.font,
                settings.size,
                settings.lineHeight,
                settings.title,
                settings.pageFont || settings.font,
                settings.pageSize || '12px',
                settings.pageBold,
                settings
            );
            this.openPreview(htmlContent);
        }

        showPrintDialog() {
            this.openPreviewWithSettings();
        }

        triggerShowAnswers() {
            const cb = document.querySelector('#isshowAnswer');
            if (cb && !cb.checked) cb.click();
            const old = document.querySelector('.tklabel-checkbox.show-answer input');
            if (old && !old.checked) old.click();
        }

        waitForImages(timeout = 15000) {
            return new Promise(resolve => {
                const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.src.includes('getAnswerAndParse'));
                if (imgs.length === 0) return resolve();
                let loaded = 0;
                const timer = setTimeout(() => resolve(), timeout);
                const checkDone = () => { loaded++; if (loaded >= imgs.length) { clearTimeout(timer); resolve(); } };
                imgs.forEach(img => {
                    if (img.complete) checkDone();
                    else { img.addEventListener('load', checkDone, { once: true }); img.addEventListener('error', checkDone, { once: true }); }
                });
            });
        }

        removeLeadingNumber(container) {
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent.match(/^\s*\d+\.\s*/)) {
                    node.textContent = node.textContent.replace(/^\s*\d+\.\s*/, '');
                    break;
                }
            }
        }

        isFormulaSvgImage(image) {
            const source = String(image.getAttribute('src') || '').toLowerCase();
            const hint = `${image.className || ''} ${image.getAttribute('alt') || ''}`.toLowerCase();
            return /(?:\.svg(?:[?#]|$)|^data:image\/svg\+xml)/.test(source)
                || /(?:math|formula|latex|katex|mathjax)/.test(hint);
        }

        preparePreviewTypography(root) {
            root.querySelectorAll('img').forEach(image => {
                if (!this.isFormulaSvgImage(image)) return;
                image.classList.add('zujuanjs-formula-svg');
                image.dataset.formulaBaseline = '14';
                const pixelStyle = value => /^\s*\d+(?:\.\d+)?px\s*$/.test(value || '') ? Number.parseFloat(value) : 0;
                const width = Number.parseFloat(image.getAttribute('width')) || pixelStyle(image.style.width);
                const height = Number.parseFloat(image.getAttribute('height')) || pixelStyle(image.style.height);
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

        generatePreviewHTML(includeQ, includeA, atEnd, font, size, lineHeight, title, pageFont, pageSize, pageBold, layoutOptions = {}) {
            const marginValues = String(layoutOptions.pageMargins || '18,15,22,15')
                .split(',')
                .map(value => Number(value));
            const validMargins = marginValues.length === 4 && marginValues.every(value => Number.isFinite(value) && value >= 8 && value <= 55);
            const [marginTop, marginRight, marginBottom, marginLeft] = validMargins ? marginValues : [18, 15, 22, 15];
            const contentWidth = 210 - marginLeft - marginRight;
            const contentHeight = 297 - marginTop - marginBottom;
            const footerBottom = Math.max(5, Math.min(9, marginBottom / 3));
            const questionSpacing = Math.max(0, Math.min(32, Number(layoutOptions.questionSpacing) || 10));
            const previewLayout = layoutOptions.previewLayout === 'single' ? 'single' : 'double';
            const rawPreviewZoom = String(layoutOptions.previewZoom || 'auto');
            const numericPreviewZoom = Number(rawPreviewZoom);
            const previewZoom = rawPreviewZoom === 'auto'
                ? 'auto'
                : String(Math.max(0.25, Math.min(2, Number.isFinite(numericPreviewZoom) ? numericPreviewZoom : 1)));
            const titleSize = Math.max(18, Math.min(36, Number(layoutOptions.titleSize) || 24));
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
            const previewSettingsJson = JSON.stringify({
                mode: layoutOptions.mode || 'q', font, size, lineHeight, title, titleSize: `${titleSize}px`,
                pageFont, pageSize, pageBold, showPageNumber, pageMargins: `${marginTop},${marginRight},${marginBottom},${marginLeft}`,
                questionSpacing: String(questionSpacing), previewLayout, previewZoom,
                paragraphSpacing: String(paragraphSpacing), contentAlign, numberGap: String(numberGap),
                answerRowHeight: String(answerRowHeight), pageGap: String(pageGap),
                editorPanelWidth: String(editorPanelWidth), editorPanelTab, editorOpen, documentEdits, readingAnchor
            }).replace(/</g, '\\u003c');
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

            document.querySelectorAll('.sec-title, .tk-quest-item.quesroot').forEach(node => {
                if (node.classList.contains('sec-title')) {
                    const span = node.querySelector('span');
                    if (span) {
                        const section = document.createElement('div');
                        section.className = 'zujuanjs-section-title';
                        section.style.fontFamily = font;
                        section.textContent = span.textContent.trim();
                        tempDiv.appendChild(section);
                    }
                    return;
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
                        questionLayout.appendChild(numSpan);
                        questionLayout.appendChild(questionBody);
                        qDiv.appendChild(questionLayout);
                    }
                }

                const opt = wrap.querySelector('.exam-item__opt');
                if (opt) {
                    const optClone = opt.cloneNode(true);
                    optClone.querySelector('.knowledge-box')?.remove();

                    if (includeA) {
                        (questionBody || qDiv).appendChild(optClone);
                    } else if (atEnd) {
                        const answerWrap = document.createElement('div');
                        answerWrap.className = 'zujuanjs-answer-item';
                        answerWrap.style.fontFamily = font;
                        answerWrap.style.fontSize = size;
                        answerWrap.style.lineHeight = lineHeight;
                        const answerHeader = document.createElement('div');
                        answerHeader.className = 'zujuanjs-answer-title';
                        answerHeader.style.fontFamily = font;
                        answerHeader.textContent = `第 ${questionIndex} 题解析`;
                        answerWrap.appendChild(answerHeader);
                        answerWrap.appendChild(optClone);

                        const ansWrapper = document.createElement('div');
                        ansWrapper.className = 'q-wrapper';
                        ansWrapper.dataset.blockId = `answer-${questionIndex}`;
                        ansWrapper.dataset.blockLabel = `第 ${questionIndex} 题解析`;
                        ansWrapper.tabIndex = 0;
                        ansWrapper.setAttribute('aria-label', `第 ${questionIndex} 题解析`);
                        ansWrapper.appendChild(answerWrap);
                        answersEndList.push(ansWrapper);
                    }
                }

                qWrapper.appendChild(qDiv);
                tempDiv.appendChild(qWrapper);
                questionIndex++;
            });

            if (atEnd && answersEndList.length) {
                const section = document.createElement('div');
                section.className = 'zujuanjs-section-title';
                section.style.fontFamily = font;
                section.textContent = '答案与解析';
                tempDiv.appendChild(section);
                answersEndList.forEach(a => tempDiv.appendChild(a));
            }

            this.preparePreviewTypography(tempDiv);

            tempDiv.querySelectorAll('img').forEach(img => {
                if (img.src) img.setAttribute('src', img.src);
            });

            const contentHtml = tempDiv.innerHTML;
            const fontWeight = pageBold ? 'bold' : 'normal';

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

                    .zujuanjs-section-title { font-size: 1.25em; font-weight: bold; margin: 22px 0 12px; border-left: 4px solid #000; padding-left: 8px; page-break-inside: avoid; }
                    .zujuanjs-print-title { font-size: 24px; text-align: center; font-weight: bold; margin: 15px 0 30px; line-height: 1.4; page-break-inside: avoid; }
                    .zujuanjs-question { margin-bottom: 18px; padding: 4px 0; border-bottom: none; }
                    .zujuanjs-question-number { font-weight: bold; white-space: pre; }
                    .zujuanjs-answer-item { margin-bottom: 18px; padding: 4px 0; border: none; }
                    .zujuanjs-answer-title { font-weight: bold; margin-bottom: 6px; }
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
                    .manual-break-indicator {
                        position: absolute;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        border-bottom: 1px dashed #ff4d4f;
                        color: #ff4d4f;
                        font-size: 11px;
                        line-height: 18px;
                        text-align: center;
                        pointer-events: none;
                    }
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
                    body.question-tools-open .preview-workspace { top: 112px; }
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
                    .question-float-toolbar {
                        border-color: #c9dbd5;
                        background: #fdfefd;
                        box-shadow: 0 10px 24px rgba(25,51,47,0.20);
                    }
                    .question-toolbar-label { color: var(--ui-text); }
                    .question-float-toolbar .btn[aria-pressed="true"] {
                        border-color: #75b9aa;
                        color: #075e58;
                        background: var(--ui-accent-soft);
                    }
                    .question-line-count {
                        border-color: #d4dfdb;
                        color: #53615d;
                        background: #f2f6f4;
                    }

                    .question-float-toolbar {
                        position: fixed;
                        top: calc(var(--toolbar-height) + 8px);
                        left: 8px;
                        z-index: 2147483000;
                        display: flex;
                        max-width: calc(100vw - 16px);
                        min-height: 40px;
                        align-items: center;
                        gap: 6px;
                        padding: 4px 6px;
                        overflow-x: auto;
                        border: 1px solid #cfd4da;
                        border-radius: 6px;
                        background: #fff;
                        box-shadow: 0 6px 20px rgba(0,0,0,0.22);
                        opacity: 0;
                        visibility: hidden;
                        pointer-events: none;
                        scrollbar-width: none;
                        transition: opacity 0.12s ease;
                    }
                    .question-float-toolbar::-webkit-scrollbar { display: none; }
                    .question-float-toolbar.is-visible {
                        opacity: 1;
                        visibility: visible;
                        pointer-events: auto;
                    }
                    .question-toolbar-label {
                        max-width: 94px;
                        overflow: hidden;
                        color: #34383d;
                        font-size: 12px;
                        font-weight: 650;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .question-float-toolbar .btn-group { flex: 0 0 auto; }
                    .question-float-toolbar .btn {
                        display: inline-flex;
                        height: 32px;
                        min-height: 32px;
                        align-items: center;
                        justify-content: center;
                        padding: 0 9px;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: 600;
                        line-height: 1;
                        letter-spacing: 0;
                        white-space: nowrap;
                    }
                    .question-float-toolbar .btn[aria-pressed="true"] {
                        border-color: #1677ff;
                        color: #0f5fc4;
                        background: #eaf3ff;
                    }
                    .question-float-toolbar .btn:focus-visible { outline: 2px solid #1677ff; outline-offset: 1px; }
                    .question-float-toolbar .btn-outline-danger > span[aria-hidden="true"] { display: none; }
                    .question-toolbar-short-label { display: none; }
                    .question-line-count {
                        display: inline-flex;
                        width: 52px;
                        height: 32px;
                        align-items: center;
                        justify-content: center;
                        border-top: 1px solid #dee2e6;
                        border-bottom: 1px solid #dee2e6;
                        color: #4f555b;
                        background: #f8f9fa;
                        font-size: 11px;
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
                            top: calc(var(--toolbar-height) + 8px) !important;
                            right: 8px;
                            left: 8px !important;
                            max-width: none;
                            min-height: 52px;
                            padding: 4px;
                            gap: 4px;
                        }
                        .question-float-toolbar .btn { height: 44px; min-height: 44px; padding: 0 10px; }
                        .question-line-count { height: 44px; }
                        .question-toolbar-label { display: none; }
                        body.editor-open .question-float-toolbar { display: none !important; }
                        body.question-tools-open .preview-workspace { top: 132px; }
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
                        <span class="preview-page-count" id="preview-page-count" aria-live="polite" aria-atomic="true">排版中…</span>
                    </div>
                    <div class="toolbar-section">
                        <div class="zoom-control btn-group btn-group-sm" role="group" aria-label="预览缩放">
                            <button type="button" class="btn btn-outline-light" data-zoom="out" title="缩小" aria-label="缩小">−</button>
                            <button type="button" class="btn btn-outline-light zoom-value" id="zoom-value" data-zoom="auto" title="自动适应">自动</button>
                            <button type="button" class="btn btn-outline-light" data-zoom="in" title="放大" aria-label="放大">+</button>
                        </div>
                    </div>
                    <div class="toolbar-section">
                        <button type="button" class="btn btn-outline-light btn-sm editor-toggle" id="editor-toggle" title="排版工具" aria-label="排版工具" aria-controls="editor-panel" aria-expanded="false"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.47 1.47 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.47 1.47 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.47 1.47 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.47 1.47 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.47 1.47 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.47 1.47 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.47 1.47 0 0 1-2.105-.872l-.1-.34ZM8 10.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg></button>
                        <button type="button" class="btn btn-primary btn-sm print-action" onclick="window.print()" title="打印"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1a2 2 0 0 0-2 2v2h2V3h6v2h2V3a2 2 0 0 0-2-2H5Zm-1 9h8v5H4v-5Zm1 1v3h6v-3H5ZM2 5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1V9h10v4h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H2Zm11 2.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z"/></svg><span class="print-action-label">打印</span></button>
                        <button type="button" class="btn btn-outline-light btn-sm close" title="关闭预览" aria-label="关闭预览" onclick="window.parent.postMessage({type: 'closeZujuanPreview'}, '*')"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.146 4.146a.5.5 0 0 1 .708 0L8 7.293l3.146-3.147a.5.5 0 0 1 .708.708L8.707 8l3.147 3.146a.5.5 0 0 1-.708.708L8 8.707l-3.146 3.147a.5.5 0 0 1-.708-.708L7.293 8 4.146 4.854a.5.5 0 0 1 0-.708Z"/></svg></button>
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
                            <button type="button" class="btn btn-light btn-sm" id="editor-close" title="收起" aria-label="收起排版工具">×</button>
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
                                            <select class="form-select form-select-sm" id="setting-mode"><option value="q">仅试题</option><option value="qa">试题与答案</option><option value="qe">答案附末尾</option><option value="a">仅答案</option></select>
                                        </label>
                                        <label class="editor-field wide">试卷标题<input class="form-control form-control-sm" id="setting-title" type="text"></label>
                                        <label class="editor-field">标题字号<select class="form-select form-select-sm" id="setting-title-size"><option value="20px">20px</option><option value="24px">24px</option><option value="28px">28px</option><option value="32px">32px</option></select></label>
                                        <label class="editor-field editor-field-unit">题间距<input class="form-control form-control-sm" id="setting-spacing" type="number" min="0" max="32" step="1"><span>px</span></label>
                                    </div>
                                </section>
                                <section class="editor-section">
                                    <div class="editor-section-title">正文</div>
                                    <div class="editor-grid">
                                        <label class="editor-field wide">字体<select class="form-select form-select-sm" id="setting-font"><option value='"Times New Roman", SimSun, "Songti SC", serif'>宋体 + 新罗马</option><option value='SimSun, "Songti SC", serif'>宋体</option><option value='"Microsoft YaHei", "PingFang SC", sans-serif'>微软雅黑</option><option value='SimHei, "PingFang SC", sans-serif'>黑体</option><option value='KaiTi, "Songti SC", serif'>楷体</option></select></label>
                                        <label class="editor-field">字号<select class="form-select form-select-sm" id="setting-size"><option value="14px">14px</option><option value="16px">16px</option><option value="18px">18px</option><option value="20px">20px</option><option value="22px">22px</option></select></label>
                                        <label class="editor-field">行距<select class="form-select form-select-sm" id="setting-line-height"><option value="1.2">1.2</option><option value="1.35">1.35</option><option value="1.5">1.5</option><option value="1.75">1.75</option><option value="2">2.0</option></select></label>
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
                                        <label class="editor-field wide">字体<select class="form-select form-select-sm" id="setting-page-font"><option value='"Times New Roman", SimSun, "Songti SC", serif'>宋体 + 新罗马</option><option value='SimSun, "Songti SC", serif'>宋体</option><option value='"Microsoft YaHei", "PingFang SC", sans-serif'>微软雅黑</option><option value='SimHei, "PingFang SC", sans-serif'>黑体</option></select></label>
                                        <label class="editor-field">字号<select class="form-select form-select-sm" id="setting-page-size"><option value="10px">10px</option><option value="12px">12px</option><option value="14px">14px</option><option value="16px">16px</option></select></label>
                                        <label class="editor-check"><input class="form-check-input" id="setting-page-bold" type="checkbox">加粗</label>
                                    </div>
                                </section>
                            </div>
                        </div>
                        <div class="editor-panel-footer">
                            <button type="button" class="editor-reset btn btn-outline-secondary btn-sm w-100" id="editor-reset">恢复考试默认</button>
                        </div>
                    </aside>
                </div>
                <div class="question-float-toolbar" id="question-float-toolbar" role="toolbar" aria-label="当前题目排版工具" aria-hidden="true" data-active-block-id="">
                    <span class="question-toolbar-label" id="question-toolbar-label">当前题目</span>
                    <div class="btn-group btn-group-sm" role="group" aria-label="答题行数">
                        <button type="button" class="btn btn-outline-secondary" data-question-action="remove-line" title="减少一行答题空间" aria-label="减少一行答题空间">−</button>
                        <span class="question-line-count" id="question-line-count" aria-live="polite">0 行</span>
                        <button type="button" class="btn btn-outline-secondary" data-question-action="add-line" title="增加一行答题空间" aria-label="增加一行答题空间">+</button>
                    </div>
                    <button type="button" class="btn btn-outline-secondary" data-question-action="add-lines" title="增加四行答题空间">+4行</button>
                    <div class="btn-group btn-group-sm" role="group" aria-label="手动分页">
                        <button type="button" class="btn btn-outline-secondary" data-question-action="break-before" aria-label="在本题前分页" aria-pressed="false"><span class="question-toolbar-wide-label">前分页</span><span class="question-toolbar-short-label" aria-hidden="true">前</span></button>
                        <button type="button" class="btn btn-outline-secondary" data-question-action="break-after" aria-label="在本题后分页" aria-pressed="false"><span class="question-toolbar-wide-label">后分页</span><span class="question-toolbar-short-label" aria-hidden="true">后</span></button>
                    </div>
                    <button type="button" class="btn btn-outline-danger" data-question-action="clear" title="清除本题留白和分页"><span class="question-toolbar-wide-label">清除</span><span aria-hidden="true">×</span></button>
                </div>
                <script>
                    const sourceContent = document.getElementById('source-content');
                    const paperContainer = document.getElementById('paper-container');
                    const pageViewport = document.getElementById('page-viewport');
                    const paperWidthPx = 210 * (96 / 25.4);
                    const paperHeightPx = 297 * (96 / 25.4);
                    const zoomSteps = [0.25, 0.33, 0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
                    const overflowTolerance = 0.75;
                    const previewSettings = ${previewSettingsJson};
                    const editorPanel = document.getElementById('editor-panel');
                    const editorToggle = document.getElementById('editor-toggle');
                    const editorResizeHandle = document.getElementById('editor-resize-handle');
                    const questionToolbar = document.getElementById('question-float-toolbar');
                    const editorSaveStatus = document.getElementById('editor-save-status');
                    const layoutPresetNote = document.getElementById('layout-preset-note');
                    const layoutPresets = Object.freeze({
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
                        const requested = layoutPresets[previewSettings.layoutPreset] ? previewSettings.layoutPreset : 'custom';
                        const preset = layoutPresets[requested];
                        const matchesPreset = preset && Object.entries(preset.settings).every(([key, value]) => String(previewSettings[key]) === String(value));
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
                        window.parent.postMessage({ type: 'saveZujuanPreviewPreference', key: key, value: String(value) }, '*');
                    }

                    function savePrintSettings() {
                        previewSettings.documentEdits = serializeBlockEdits();
                        previewSettings.editorPanelWidth = String(currentPanelWidth);
                        previewSettings.editorPanelTab = currentEditorTab;
                        previewSettings.editorOpen = editorOpen;
                        window.parent.postMessage({ type: 'saveZujuanPrintSettings', settings: previewSettings }, '*');
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
                        setSelectValue('setting-mode', previewSettings.mode);
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
                        updateLayoutPresetUI();
                    }

                    function readSettingsFromEditor() {
                        const margin = side => clamp(document.getElementById('setting-margin-' + side).value, 8, 55, 15);
                        return {
                            mode: document.getElementById('setting-mode').value,
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
                        document.documentElement.style.setProperty('--formula-scale', String(ratio));
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
                        const contentWidth = 210 - left - right;
                        const contentHeight = 297 - top - bottom;
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
                        root.style.setProperty('--title-size', clamp(previewSettings.titleSize, 18, 36, 24) + 'px');
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
                            document.body.classList.remove('question-tools-open');
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
                        const viewportRect = pageViewport.getBoundingClientRect();
                        setQuestionToolbarVisible(true);
                        const toolbarRect = questionToolbar.getBoundingClientRect();
                        const margin = 8;
                        const left = Math.max(
                            viewportRect.left + margin,
                            Math.min(
                                viewportRect.left + (viewportRect.width - toolbarRect.width) / 2,
                                viewportRect.right - toolbarRect.width - margin
                            )
                        );
                        questionToolbar.style.top = '64px';
                        questionToolbar.style.left = Math.round(left) + 'px';
                    }

                    function activateQuestion(wrapper) {
                        const blockId = wrapper?.dataset.blockId;
                        if (!blockId) return;
                        activeBlockId = blockId;
                        document.body.classList.add('question-tools-open');
                        questionToolbar.dataset.activeBlockId = blockId;
                        paperContainer.querySelectorAll('.q-wrapper').forEach(fragment => {
                            fragment.classList.toggle('is-selected', fragment.dataset.blockId === blockId);
                        });
                        updateQuestionToolbarState();
                        scheduleQuestionToolbarPosition();
                    }

                    function bindRenderedQuestionInteractions() {
                        paperContainer.querySelectorAll('.q-wrapper').forEach(wrapper => {
                            wrapper.addEventListener('pointerenter', () => activateQuestion(wrapper));
                            wrapper.addEventListener('focusin', () => activateQuestion(wrapper));
                            wrapper.addEventListener('click', event => {
                                event.stopPropagation();
                                activateQuestion(wrapper);
                            });
                            wrapper.addEventListener('keydown', event => {
                                if (!['Enter', ' '].includes(event.key)) return;
                                event.preventDefault();
                                activateQuestion(wrapper);
                            });
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

                                // 兼容没有文字节点、但自身有高度的站点组件。
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
                        marker.textContent = '手动分页';
                        pageContent.appendChild(marker);
                    }

                    function updatePageNumbers() {
                        const papers = Array.from(paperContainer.querySelectorAll('.paper'));
                        papers.forEach((paper, index) => {
                            const footer = paper.querySelector('.page-footer');
                            footer.textContent = (index + 1) + ' / ' + papers.length;
                            footer.style.display = previewSettings.showPageNumber === false ? 'none' : '';
                        });
                        document.getElementById('preview-page-count').textContent = '共 ' + papers.length + ' 页';
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

                        while (queue.length && guard < 10000) {
                            guard++;
                            const node = queue.shift();

                            if (node.classList.contains('page-break')) {
                                if (pageHasContent(page.content)) {
                                    addManualBreakMarker(page.content);
                                    page = createPaper();
                                }
                                continue;
                            }

                            const pageAlreadyHasContent = pageHasContent(page.content);
                            page.content.appendChild(node);
                            if (!nodeOverflowsPage(node, page.content)) continue;

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

                    document.querySelectorAll('[data-layout]').forEach(button => {
                        button.addEventListener('click', () => setPreviewLayout(button.dataset.layout));
                    });
                    document.querySelector('[data-zoom="out"]').addEventListener('click', () => stepPreviewZoom(-1));
                    document.querySelector('[data-zoom="in"]').addEventListener('click', () => stepPreviewZoom(1));
                    document.querySelector('[data-zoom="auto"]').addEventListener('click', () => setPreviewZoom('auto'));
                    editorToggle.addEventListener('click', () => toggleEditor());
                    document.getElementById('editor-close').addEventListener('click', () => toggleEditor(false));

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
                            setSaveStatus('正在保存…');
                            if (control.id === 'setting-mode') {
                                const nextSettings = readSettingsFromEditor();
                                window.parent.postMessage({ type: 'rebuildZujuanPreview', settings: nextSettings }, '*');
                                return;
                            }
                            queueEditorSettings();
                        });
                    });
                    document.getElementById('editor-reset').addEventListener('click', () => {
                        applyLayoutPreset('exam');
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

                    paperContainer.addEventListener('click', event => {
                        if (!event.target.closest('.q-wrapper')) hideQuestionToolbar();
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
                    document.body.classList.toggle('question-tools-open', Boolean(activeBlockId));
                    applyBlockEditsToSource();
                    writeSettingsToEditor();
                    applyDocumentStyles();
                    applyEditorPanelWidth(currentPanelWidth);
                    setEditorTab(currentEditorTab, false);
                    toggleEditor(editorOpen, false);
                    requestAnimationFrame(() => editorPanel.classList.remove('editor-initializing'));
                    scheduleRender();
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
            const iframe = document.createElement('iframe');
            iframe.title = '试卷排版预览';
            iframe.srcdoc = htmlContent;
            overlay.innerHTML = '';
            overlay.appendChild(iframe);
        }
    }

    new PaperPrinter();
})();
