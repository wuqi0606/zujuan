// ==UserScript==
// @name         组卷网/学科网试卷打印助手
// @version      4.3.3
// @description  自动处理组卷网/学科网试卷，全面支持自定义排版、字体、页码与题号对齐
// @author       nuym, WorkingFishQ, xiaohuya
// @match        *://zujuan.xkw.com/*
// @icon         https://zujuan.xkw.com/favicon.ico
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @require      https://fastly.jsdelivr.net/npm/sweetalert2@11
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
        #zujuanjs-print-area { display: none; }

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
            .zujuanjs-float-print-btn { width: auto !important; height: auto !important; border-radius: 28px !important; padding: 12px 24px !important; font-size: 15px !important; font-weight: 500 !important; letter-spacing: 0.5px !important; }
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

        /* 内容模式卡片 */
        .print-option-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .print-option-card {
            display: flex; align-items: center; gap: 6px; padding: 8px 12px;
            border: 1px solid #e8e8e8; border-radius: 6px; cursor: pointer; background: #fafafa; transition: all 0.2s ease;
        }
        .print-option-card:hover { background: #f0f5ff; border-color: #91caff; }
        .print-option-card.active { background: #e6f4ff; border-color: #1677ff; }
        .print-option-card input[type="radio"] { width: 14px; height: 14px; margin: 0; accent-color: #1677ff; flex-shrink: 0; }
        .print-option-card span { font-size: 12px; color: #434343; }

        /* 三列字段布局 */
        .print-row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .print-field { min-width: 0; }
        .print-field-label { font-size: 11px; color: #888; margin-bottom: 4px; line-height: 1.2; }

        /* 下拉选择框 */
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

        /* 预览框 */
        .print-preview-box {
            padding: 12px 14px; border: 1px solid #e8e8e8; border-radius: 6px;
            background: #f9f9f9; min-height: 40px; line-height: 1.6; font-size: 14px;
            color: #333; overflow: hidden;
        }

        /* SweetAlert2 弹窗紧凑化覆盖 */
        .swal2-popup.print-dialog-popup { padding: 18px 22px 16px !important; }
        .swal2-popup.print-dialog-popup .swal2-title { font-size: 18px !important; margin: 0 0 12px !important; padding: 0 !important; }
        .swal2-popup.print-dialog-popup .swal2-html-container { margin: 0 !important; padding: 0 !important; font-size: inherit !important; }
        .swal2-popup.print-dialog-popup .swal2-actions { margin: 14px 0 0 !important; gap: 8px !important; }
        .swal2-popup.print-dialog-popup .swal2-confirm,
        .swal2-popup.print-dialog-popup .swal2-cancel { padding: 8px 22px !important; font-size: 13px !important; font-weight: 500 !important; border-radius: 6px !important; box-shadow: none !important; }

        @media print {
            .zujuanjs-float-print-btn { display: none !important; }
            body > :not(#zujuanjs-print-area) { display: none !important; }
            #zujuanjs-print-area { display: block !important; width: 100% !important; background: #fff !important; }
            #zujuanjs-reformatted-content,
            #zujuanjs-reformatted-content *,
            .zujuanjs-print-title,
            .zujuanjs-section-title,
            .zujuanjs-question,
            .zujuanjs-answer-item,
            .zujuanjs-answer-title { color: #000 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            .zujuanjs-print-title { font-size: 24px !important; text-align: center !important; font-weight: bold !important; margin: 15px 0 30px !important; line-height: 1.4 !important; }
            .zujuanjs-question { margin-bottom: 18px; padding: 4px 0; border-bottom: none !important; page-break-inside: auto !important; orphans: 2; widows: 2; }
            .zujuanjs-question-number { font-weight: bold; white-space: pre; }
            .zujuanjs-section-title { font-size: 1.25em; font-weight: bold; margin: 22px 0 12px; border-left: 4px solid #000 !important; padding-left: 8px; page-break-after: avoid; }
            .zujuanjs-answer-item { margin-bottom: 18px; padding: 4px 0; border: none !important; page-break-inside: auto !important; orphans: 2; widows: 2; }
            .zujuanjs-answer-title { font-weight: bold; margin-bottom: 6px; page-break-after: avoid; }
            img { page-break-inside: avoid !important; filter: grayscale(100%) contrast(120%); }
        }
    `);

    class PaperPrinter {
        constructor() { this.init(); }

        init() {
            this.applyFont();
            this.autoCheckIn();
            this.createFloatingButton();
            if (document.body) this.startAdRemover();
            else document.addEventListener('DOMContentLoaded', () => this.startAdRemover());
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
            btn.innerHTML = '<span class="zujuanjs-float-print-btn-icon">🖨️</span><span class="zujuanjs-float-print-btn-text">打印试卷</span>';
            btn.onclick = (e) => { e.preventDefault(); this.showPrintDialog(); };
            document.body.appendChild(btn);
        }

        startAdRemover() {
            const observer = new MutationObserver(() => {
                Config.adSelectors.forEach(sel => document.querySelector(sel)?.remove());
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        // 预设选项
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
                { value: '14px', text: '14px' },
                { value: '15px', text: '15px' },
                { value: '16px', text: '16px' },
                { value: '17px', text: '17px' },
                { value: '18px', text: '18px' },
                { value: '20px', text: '20px' },
                { value: '22px', text: '22px' }
            ];
        }

        getLineHeightOptions() {
            return [
                { value: '1.2', text: '1.2 · 紧凑' },
                { value: '1.35', text: '1.35' },
                { value: '1.5', text: '1.5 · 标准' },
                { value: '1.75', text: '1.75' },
                { value: '2.0', text: '2.0 · 宽松' }
            ];
        }

        getPageSizeOptions() {
            return [
                { value: '10px', text: '10px' },
                { value: '12px', text: '12px' },
                { value: '14px', text: '14px' },
                { value: '16px', text: '16px' },
                { value: '18px', text: '18px' }
            ];
        }

        getBoldOptions() {
            return [
                { value: 'false', text: '不加粗' },
                { value: 'true', text: '加粗' }
            ];
        }

        renderSelect(id, options, defaultValue) {
            // 兼容自定义值：如果保存的值不在预设里，把它作为"自定义"项放到顶部
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

        showPrintDialog() {
            const savedFont = GM_getValue('questionFont', '"Times New Roman", SimSun, "Songti SC", serif');
            const savedSize = GM_getValue('questionSize', '16px');
            const savedLineHeight = GM_getValue('questionLineHeight', '1.5');
            const savedPageFont = GM_getValue('pageFont', savedFont);
            const savedPageSize = GM_getValue('pageSize', '12px');
            const savedPageBold = String(GM_getValue('pageBold', true)); // 统一转为字符串以匹配下拉框
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

            // 关闭其他下拉的处理器（持久监听，弹窗关闭时移除）
            const closeAllSelects = (e) => {
                if (!e.target.closest('.print-custom-select')) {
                    document.querySelectorAll('.print-custom-select.open').forEach(s => s.classList.remove('open'));
                }
            };

            Swal.fire({
                title: '打印设置',
                width: 560,
                customClass: { popup: 'print-dialog-popup' },
                confirmButtonColor: '#1677ff',
                cancelButtonColor: '#d9d9d9',
                html: `
                    <div class="print-dialog-container">
                        <div class="print-dialog-section">
                            <label class="print-dialog-label">试卷标题</label>
                            <input type="text" id="print-title-input" class="print-dialog-input" value="${defaultTitle}" placeholder="留空则不显示标题">
                        </div>

                        <div class="print-dialog-section">
                            <label class="print-dialog-label">打印内容</label>
                            <div class="print-option-grid" id="print-mode-grid">
                                ${modeOptions.map((m, i) => `
                                    <label class="print-option-card${i === 0 ? ' active' : ''}">
                                        <input type="radio" name="printMode" value="${m.value}" ${i === 0 ? 'checked' : ''}>
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
                            <label class="print-dialog-label">效果预览</label>
                            <div class="print-preview-box" id="print-preview">
                                1.&emsp;已知函数 f(x) = ax² + bx + c (a ≠ 0)，在区间 [1, 5] 上单调递增。求该二次函数的对称轴及参数 a 的取值范围。
                            </div>
                        </div>
                    </div>`,
                confirmButtonText: '开始打印',
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

                    document.querySelectorAll('#print-mode-grid .print-option-card').forEach(card => {
                        card.addEventListener('click', () => {
                            document.querySelectorAll('#print-mode-grid .print-option-card').forEach(c => c.classList.remove('active'));
                            card.classList.add('active');
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
                    pageBold: document.getElementById('print-pagebold-select')?.dataset.value === 'true'
                })
            }).then(async res => {
                if (!res.isConfirmed) return;
                const { mode, font, size, lineHeight, title, pageFont, pageSize, pageBold } = res.value;
                GM_setValue('questionFont', font);
                GM_setValue('questionSize', size);
                GM_setValue('questionLineHeight', lineHeight);
                GM_setValue('pageFont', pageFont || font);
                GM_setValue('pageSize', pageSize || '12px');
                GM_setValue('pageBold', pageBold);

                const includeQuestions = mode !== 'a';
                const includeAnswers = mode === 'qa' || mode === 'a';
                const answersAtEnd = mode === 'qe';

                if (includeAnswers || answersAtEnd) {
                    Swal.fire({ title: '请稍候', text: '正在准备答案解析...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    this.triggerShowAnswers();
                    await this.waitForImages();
                    Swal.close();
                }
                this.executePrint(includeQuestions, includeAnswers, answersAtEnd, font, size, lineHeight, title, pageFont || font, pageSize || '12px', pageBold);
            });
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

        executePrint(includeQ, includeA, atEnd, font, size, lineHeight, title, pageFont, pageSize, pageBold) {
            const originalTitle = document.title;
            if (title) document.title = title;

            let pageStyle = document.getElementById('zujuanjs-page-setup-style');
            if (pageStyle) pageStyle.remove();
            pageStyle = document.createElement('style');
            pageStyle.id = 'zujuanjs-page-setup-style';

            const fontWeight = pageBold ? 'bold' : 'normal';
            pageStyle.textContent = `
                @media print {
                    @page {
                        size: A4;
                        margin: 18mm 15mm 22mm 15mm !important;
                        @bottom-center {
                            content: counter(page) " / " counter(pages);
                            font-family: ${pageFont} !important;
                            font-size: ${pageSize} !important;
                            font-weight: ${fontWeight} !important;
                            color: #000 !important;
                        }
                    }
                    body { margin: 0 !important; }
                }`;
            document.head.appendChild(pageStyle);

            let printArea = document.getElementById('zujuanjs-print-area');
            if (!printArea) {
                printArea = document.createElement('div');
                printArea.id = 'zujuanjs-print-area';
                document.body.appendChild(printArea);
            }
            printArea.innerHTML = '';

            const contentWrapper = document.createElement('div');
            contentWrapper.id = 'zujuanjs-reformatted-content';
            contentWrapper.style.fontFamily = font;

            if (title) {
                const titleEl = document.createElement('div');
                titleEl.className = 'zujuanjs-print-title';
                titleEl.style.fontFamily = font;
                titleEl.textContent = title;
                contentWrapper.appendChild(titleEl);
            }

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
                        contentWrapper.appendChild(section);
                    }
                    return;
                }

                const wrap = node.querySelector('.wrapper.quesdiv');
                if (!wrap) return;

                const qDiv = document.createElement('div');
                qDiv.className = 'zujuanjs-question';
                qDiv.style.fontFamily = font;
                qDiv.style.fontSize = size;
                qDiv.style.lineHeight = lineHeight;

                if (includeQ) {
                    const cnt = wrap.querySelector('.exam-item__cnt');
                    if (cnt) {
                        const cntClone = cnt.cloneNode(true);
                        this.removeLeadingNumber(cntClone);
                        const numSpan = document.createElement('span');
                        numSpan.className = 'zujuanjs-question-number';
                        numSpan.textContent = `${questionIndex}.\t`;
                        cntClone.insertBefore(numSpan, cntClone.firstChild);
                        qDiv.appendChild(cntClone);
                    }
                }

                const opt = wrap.querySelector('.exam-item__opt');
                if (opt) {
                    const optClone = opt.cloneNode(true);
                    optClone.querySelector('.knowledge-box')?.remove();

                    if (includeA) {
                        qDiv.appendChild(optClone);
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
                        answersEndList.push(answerWrap);
                    }
                }

                contentWrapper.appendChild(qDiv);
                questionIndex++;
            });

            if (atEnd && answersEndList.length) {
                const section = document.createElement('div');
                section.className = 'zujuanjs-section-title';
                section.style.pageBreakBefore = 'always';
                section.style.fontFamily = font;
                section.textContent = '答案与解析';
                contentWrapper.appendChild(section);
                answersEndList.forEach(a => contentWrapper.appendChild(a));
            }

            printArea.appendChild(contentWrapper);

            setTimeout(() => {
                window.print();
                document.title = originalTitle;
                printArea.innerHTML = '';
            }, 300);
        }
    }

    new PaperPrinter();
})();