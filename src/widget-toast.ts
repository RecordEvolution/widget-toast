import { html, css, LitElement, PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { InputData } from './definition-schema.js'

type Theme = {
    theme_name: string
    theme_object: any
}

type Severity = 'success' | 'error' | 'info' | 'warning'

type Toast = {
    id: number
    message: string
    type: Severity
    leaving?: boolean
}

const DEFAULT_COLORS: Record<Severity, string> = {
    success: '#2e7d32',
    error: '#c62828',
    info: '#1565c0',
    warning: '#ed6c02'
}

const ICONS: Record<Severity, string> = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
}

// Duration of the enter/leave CSS transition. Must match the `transition` timing in the
// `.toast` style rule below — `dismissToast` waits this long before removing a toast.
const LEAVE_MS = 250

@customElement('widget-toast-versionplaceholder')
export class WidgetToast extends LitElement {
    @property({ type: Object })
    inputData?: InputData

    @property({ type: Object })
    theme?: Theme

    @state() private themeBgColor?: string
    @state() private themeTextColor?: string
    @state() private toasts: Toast[] = []

    private idCounter = 0
    private timers = new Map<number, ReturnType<typeof setTimeout>>()
    private hasReceivedFirstUpdate = false
    version: string = 'versionplaceholder'

    update(changedProperties: PropertyValues) {
        if (changedProperties.has('theme')) {
            this.registerTheme(this.theme)
        }

        if (changedProperties.has('inputData')) {
            if (!this.hasReceivedFirstUpdate) {
                // The first push carries the last persisted value (stale on dashboard load).
                // Record the baseline without popping a toast.
                this.hasReceivedFirstUpdate = true
            } else {
                const message = (this.inputData?.message ?? '').trim()
                if (message) {
                    // Each host push is a distinct backend event, so we intentionally do NOT
                    // dedupe by value — two identical consecutive messages both show.
                    this.enqueueToast(message, this.normalizeType(this.inputData?.type))
                }
            }
        }

        super.update(changedProperties)
    }

    protected firstUpdated(_changedProperties: PropertyValues): void {
        this.registerTheme(this.theme)
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this.timers.forEach((t) => clearTimeout(t))
        this.timers.clear()
    }

    registerTheme(theme?: Theme) {
        const cssTextColor = getComputedStyle(this).getPropertyValue('--re-text-color').trim()
        const cssBgColor = getComputedStyle(this).getPropertyValue('--re-tile-background-color').trim()
        this.themeBgColor = cssBgColor || theme?.theme_object?.backgroundColor
        this.themeTextColor = cssTextColor || theme?.theme_object?.title?.textStyle?.color
    }

    private normalizeType(value?: string): Severity {
        if (value === 'success' || value === 'error' || value === 'warning') return value
        return 'info'
    }

    private accentColor(type: Severity): string {
        // The per-severity color overrides are typed as empty interfaces by json2ts
        // (type: "color"), so read them defensively through an indexed cast.
        const overrides = this.inputData as Record<string, unknown> | undefined
        const override = overrides?.[`${type}Color`]
        if (typeof override === 'string' && override.trim()) return override.trim()
        return DEFAULT_COLORS[type]
    }

    private enqueueToast(message: string, type: Severity) {
        const id = Date.now() + this.idCounter++
        const maxVisible = Math.max(1, this.inputData?.maxVisible ?? 3)

        let next = [...this.toasts, { id, message, type }]

        // Enforce the visible cap: hard-drop the oldest active toasts beyond the limit,
        // clearing their timers first so no orphaned callback fires against a removed id.
        const active = next.filter((t) => !t.leaving)
        if (active.length > maxVisible) {
            const dropIds = active.slice(0, active.length - maxVisible).map((t) => t.id)
            dropIds.forEach((dropId) => this.clearTimer(dropId))
            next = next.filter((t) => !dropIds.includes(t.id))
        }

        this.toasts = next

        const displayTime = this.inputData?.displayTime ?? 4000
        if (displayTime > 0) {
            this.timers.set(
                id,
                setTimeout(() => this.dismissToast(id), displayTime)
            )
        }
    }

    private dismissToast(id: number) {
        this.clearTimer(id)
        // Flag as leaving to play the exit transition, then remove after it finishes.
        this.toasts = this.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t))
        this.timers.set(
            id,
            setTimeout(() => {
                this.toasts = this.toasts.filter((t) => t.id !== id)
                this.timers.delete(id)
            }, LEAVE_MS)
        )
    }

    private clearTimer(id: number) {
        const existing = this.timers.get(id)
        if (existing) {
            clearTimeout(existing)
            this.timers.delete(id)
        }
    }

    static styles = css`
        :host {
            display: block;
            position: relative;
            box-sizing: border-box;
            width: 100%;
            height: 100%;
            overflow: hidden;
            font-family: sans-serif;
            container-type: size;
        }

        .stack {
            position: absolute;
            display: flex;
            flex-direction: column;
            gap: 1.5cqh;
            padding: 2cqh 2cqw;
            box-sizing: border-box;
            max-width: 100%;
            max-height: 100%;
            overflow: hidden;
            pointer-events: none;
        }

        .stack.top-right {
            top: 0;
            right: 0;
            align-items: flex-end;
        }
        .stack.top-left {
            top: 0;
            left: 0;
            align-items: flex-start;
        }
        .stack.top-center {
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            align-items: center;
        }
        .stack.bottom-right {
            bottom: 0;
            right: 0;
            flex-direction: column-reverse;
            align-items: flex-end;
        }
        .stack.bottom-left {
            bottom: 0;
            left: 0;
            flex-direction: column-reverse;
            align-items: flex-start;
        }
        .stack.bottom-center {
            bottom: 0;
            left: 50%;
            transform: translateX(-50%);
            flex-direction: column-reverse;
            align-items: center;
        }

        .toast {
            pointer-events: auto;
            display: flex;
            align-items: flex-start;
            gap: 8px;
            min-width: 0;
            max-width: 100%;
            box-sizing: border-box;
            padding: 8px 10px;
            border-radius: 6px;
            border-left: 4px solid var(--toast-accent, #1565c0);
            background: var(--toast-bg, #ffffff);
            color: var(--toast-fg, #222222);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
            font-size: clamp(11px, 3.5cqw, 14px);
            line-height: 1.35;
            opacity: 1;
            transform: translateY(0);
            transition:
                opacity ${LEAVE_MS}ms ease,
                transform ${LEAVE_MS}ms ease;
        }

        .toast.leaving {
            opacity: 0;
            transform: translateY(-6px);
        }

        .icon {
            flex: 0 0 auto;
            font-weight: bold;
            color: var(--toast-accent, #1565c0);
            line-height: 1.35;
        }

        .message {
            flex: 1 1 auto;
            min-width: 0;
            white-space: pre-wrap;
            word-break: break-word;
            overflow-wrap: anywhere;
        }

        .close {
            flex: 0 0 auto;
            cursor: pointer;
            border: none;
            background: transparent;
            color: inherit;
            opacity: 0.6;
            font-size: 1em;
            line-height: 1;
            padding: 0 2px;
        }
        .close:hover {
            opacity: 1;
        }
    `

    render() {
        const position = this.inputData?.position ?? 'top-right'
        const showIcon = this.inputData?.showIcon ?? true
        const persistent = (this.inputData?.displayTime ?? 4000) === 0
        const showClose = persistent || (this.inputData?.showCloseButton ?? true)

        const bg = this.themeBgColor || '#ffffff'
        const fg = this.themeTextColor || '#222222'

        return html`
            <div class="stack ${position}">
                ${this.toasts.map((t) => {
                    const accent = this.accentColor(t.type)
                    return html`
                        <div
                            class="toast ${t.leaving ? 'leaving' : ''}"
                            role="alert"
                            style="--toast-accent:${accent};--toast-bg:${bg};--toast-fg:${fg}"
                        >
                            ${showIcon ? html`<span class="icon">${ICONS[t.type]}</span>` : ''}
                            <span class="message">${t.message}</span>
                            ${showClose
                                ? html`<button
                                      class="close"
                                      aria-label="Close"
                                      @click=${() => this.dismissToast(t.id)}
                                  >
                                      ✕
                                  </button>`
                                : ''}
                        </div>
                    `
                })}
            </div>
        `
    }
}
