// Behaviour for every enquiry form built with LeadCaptureDialog.astro:
// details -> (email code, for brochure/demo) -> done.
// All checks here are for a friendly experience only; the lead-otp Edge
// Function re-checks everything.

import { callLeadApi, LeadApiError } from './api';
import { CaptchaError, createCaptcha } from './captcha';
import { cleanOtp, OTP_LENGTH, suggestEmail, validateLead, type FieldErrors } from './rules';
import { getTrustToken, saveTrustToken } from './trust';

type Step = 'details' | 'verify' | 'success';
type Field = keyof FieldErrors | 'otp';
const FIELD_ORDER: Field[] = ['name', 'email', 'mobile', 'education', 'consent'];

export function initLeadDialogs() {
  document.querySelectorAll<HTMLDialogElement>('dialog[data-lead-dialog]').forEach((dialog) => {
    if (dialog.dataset.ready) return;
    dialog.dataset.ready = 'true';
    setupDialog(dialog);
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const formatWait = (seconds: number) =>
  seconds < 60 ? plural(Math.ceil(seconds), 'second') : plural(Math.ceil(seconds / 60), 'minute');

function describe(error: unknown): string {
  if (error instanceof CaptchaError) return error.message;
  if (error instanceof LeadApiError) {
    if (error.code === 'rate_limited' && error.data.reason === 'cooldown' && error.data.retryAfter) {
      return `Please wait ${formatWait(error.data.retryAfter)} before asking for another code.`;
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

function setupDialog(dialog: HTMLDialogElement) {
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => form.querySelector<T>(selector);
  const source = dialog.dataset.source!;
  const program = dialog.dataset.program!;
  const requiresOtp = dialog.dataset.requiresOtp === 'true';
  const downloadUrl = dialog.dataset.downloadUrl || '';

  const steps: Record<Step, HTMLElement | null> = {
    details: q('[data-step="details"]'),
    verify: q('[data-step="verify"]'),
    success: q('[data-step="success"]'),
  };
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  const otpInput = field('otp') as HTMLInputElement | null;
  const emailInput = field('email') as HTMLInputElement;
  const submitBtn = q<HTMLButtonElement>('[data-submit]')!;
  const verifyBtn = q<HTMLButtonElement>('[data-verify-submit]');
  const resendBtn = q<HTMLButtonElement>('[data-resend]');
  const formError = q('[data-form-error]')!;
  const verifyError = q('[data-verify-error]');
  const verifyStatus = q('[data-verify-status]');
  const sentTo = q('[data-sent-to]');
  const suggestion = q<HTMLButtonElement>('[data-email-suggestion]');
  const captcha = createCaptcha(q('[data-captcha]')!, requiresOtp ? 'lead_send' : 'lead_submit');

  const idleLabel = new Map<HTMLButtonElement, string>();
  [submitBtn, verifyBtn, resendBtn].forEach((b) => b && idleLabel.set(b, b.textContent!.trim()));

  let step: Step = 'details';
  let busy = false;
  let lead: Record<string, unknown> | null = null;
  let pending: { requestId: string; email: string; expiresAt: number } | null = null;
  let countdown: ReturnType<typeof setInterval> | undefined;

  function showStep(next: Step) {
    step = next;
    (Object.keys(steps) as Step[]).forEach((key) => {
      if (steps[key]) steps[key]!.hidden = key !== next;
    });
    const focusTarget =
      next === 'verify' ? otpInput : next === 'success' ? q('[data-step="success"] [data-focus]') : field('name');
    requestAnimationFrame(() => (focusTarget as HTMLElement | null)?.focus());
  }

  function showMessage(el: HTMLElement | null, message: string) {
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  }

  function setFieldError(name: Field, message: string) {
    const input = field(name);
    input?.setAttribute('aria-invalid', message ? 'true' : 'false');
    const el = q(`[data-error-for="${name}"]`);
    if (el) el.textContent = message;
  }

  function clearErrors() {
    [...FIELD_ORDER, 'otp' as const].forEach((name) => setFieldError(name, ''));
    showMessage(formError, '');
    showMessage(verifyError, '');
  }

  function showFieldErrors(errors: Record<string, string>) {
    let first: Field | null = null;
    for (const name of FIELD_ORDER) {
      if (errors[name]) {
        setFieldError(name, errors[name]);
        first ??= name;
      }
    }
    if (first) (field(first) as HTMLElement | null)?.focus();
    // Errors on fields the visitor can't edit (program/source) mean the page is out of date.
    if (!first && Object.keys(errors).length) showMessage(formError, 'Please refresh the page and try again.');
  }

  function setBusy(button: HTMLButtonElement | null, on: boolean, text?: string) {
    if (!button) return;
    button.disabled = on;
    button.setAttribute('aria-busy', String(on));
    button.textContent = on && text ? text : idleLabel.get(button) ?? button.textContent;
  }

  function stopCountdown() {
    clearInterval(countdown);
    countdown = undefined;
    if (resendBtn) {
      resendBtn.disabled = false;
      resendBtn.textContent = idleLabel.get(resendBtn)!;
    }
  }

  function startCountdown(seconds: number) {
    if (!resendBtn) return;
    stopCountdown();
    const endsAt = Date.now() + seconds * 1000;
    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      if (left <= 0) return stopCountdown();
      resendBtn.disabled = true;
      resendBtn.textContent = `Resend code in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    };
    tick();
    countdown = setInterval(tick, 1000);
  }

  function startDownload() {
    if (!downloadUrl) return;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function showSuccess() {
    pending = null;
    stopCountdown();
    showStep('success');
    startDownload();
  }

  // Sends the details: brochure/demo get a code emailed (or skip it if
  // this browser already verified the email), next-batch alert is saved.
  async function sendDetails(isResend: boolean) {
    if (busy || !lead) return;
    busy = true;
    const button = isResend ? resendBtn : submitBtn;
    setBusy(button, true, isResend ? 'Sending…' : requiresOtp ? 'Sending code…' : 'Submitting…');
    showMessage(isResend ? verifyError : formError, '');
    try {
      const captchaToken = await captcha.getToken();
      const trustToken = getTrustToken(lead.email as string);
      if (!requiresOtp) {
        await callLeadApi({ action: 'submit', lead, captchaToken, trustToken });
        showSuccess();
        return;
      }
      const res = await callLeadApi({ action: 'send', lead, captchaToken, trustToken });
      if (res.status === 'verified') {
        showSuccess();
        return;
      }
      pending = { requestId: res.requestId, email: res.email, expiresAt: Date.now() + res.expiresIn * 1000 };
      if (sentTo) sentTo.textContent = res.email;
      if (otpInput) otpInput.value = '';
      setFieldError('otp', '');
      showMessage(verifyStatus, isResend ? 'A new code is on its way. The old one no longer works.' : '');
      if (!isResend) showStep('verify');
      else otpInput?.focus();
      startCountdown(res.resendAfter ?? 60);
    } catch (error) {
      if (error instanceof LeadApiError && error.data.fields) {
        showStep('details');
        showFieldErrors(error.data.fields);
      } else {
        showMessage(isResend ? verifyError : formError, describe(error));
        if (error instanceof LeadApiError && error.data.reason === 'cooldown' && error.data.retryAfter) {
          startCountdown(error.data.retryAfter);
        }
      }
    } finally {
      busy = false;
      // A running countdown owns the resend button's label and state.
      if (isResend && countdown) button?.setAttribute('aria-busy', 'false');
      else setBusy(button, false);
      captcha.reset();
    }
  }

  function submitDetails() {
    if (busy) return;
    clearErrors();
    const result = validateLead({
      name: field('name')?.value,
      email: emailInput.value,
      mobile: field('mobile')?.value,
      education: field('education')?.value ?? '',
      consent: (field('consent') as HTMLInputElement | null)?.checked === true,
      program,
      source,
    });
    if ('errors' in result) {
      showFieldErrors(result.errors as Record<string, string>);
      return;
    }
    lead = { ...result.lead, consent: true };
    void sendDetails(false);
  }

  async function submitCode() {
    if (busy || !pending || !otpInput) return;
    const code = cleanOtp(otpInput.value);
    if (code.length !== OTP_LENGTH) {
      setFieldError('otp', `Enter the ${OTP_LENGTH}-digit code from your email.`);
      otpInput.focus();
      return;
    }
    if (Date.now() > pending.expiresAt) {
      showMessage(verifyError, 'This code has expired. Please request a new one.');
      stopCountdown();
      return;
    }
    busy = true;
    setBusy(verifyBtn, true, 'Verifying…');
    setFieldError('otp', '');
    showMessage(verifyError, '');
    showMessage(verifyStatus, '');
    try {
      const res = await callLeadApi({ action: 'verify', requestId: pending.requestId, code });
      saveTrustToken(pending.email, res.trustToken);
      showSuccess();
    } catch (error) {
      if (error instanceof LeadApiError && error.code === 'wrong_code') {
        setFieldError('otp', error.message);
        otpInput.select();
      } else {
        showMessage(verifyError, describe(error));
        // The code can't be used any more — let them ask for a new one now.
        if (error instanceof LeadApiError && ['expired', 'locked', 'used'].includes(error.code)) stopCountdown();
      }
    } finally {
      busy = false;
      setBusy(verifyBtn, false);
    }
  }

  function open() {
    if (step === 'success') {
      form.reset();
      clearErrors();
      lead = null;
      showStep('details');
    } else if (step === 'verify' && (!pending || Date.now() > pending.expiresAt)) {
      showStep('details');
    }
    dialog.showModal();
    // Start the invisible security check early so it's ready on submit.
    captcha.prepare().catch(() => {});
  }

  // ---- wiring ----
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (step === 'details') submitDetails();
    else if (step === 'verify') void submitCode();
  });

  // Clear a field's error as soon as the visitor starts fixing it.
  form.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.getAttribute('aria-invalid') === 'true') setFieldError(target.name as Field, '');
  });

  // Paste-friendly code box: keeps digits only and submits once complete.
  otpInput?.addEventListener('input', () => {
    const digits = cleanOtp(otpInput.value).slice(0, OTP_LENGTH);
    if (otpInput.value !== digits) otpInput.value = digits;
    if (digits.length === OTP_LENGTH) void submitCode();
  });

  emailInput.addEventListener('blur', () => {
    const fix = suggestEmail(emailInput.value.trim().toLowerCase());
    if (!suggestion) return;
    suggestion.hidden = !fix;
    if (fix) {
      suggestion.textContent = `Did you mean ${fix}?`;
      suggestion.dataset.value = fix;
    }
  });
  emailInput.addEventListener('input', () => suggestion && (suggestion.hidden = true));
  suggestion?.addEventListener('click', () => {
    emailInput.value = suggestion.dataset.value ?? emailInput.value;
    suggestion.hidden = true;
    emailInput.focus();
  });

  resendBtn?.addEventListener('click', () => void sendDetails(true));
  q('[data-change-details]')?.addEventListener('click', () => {
    pending = null;
    stopCountdown();
    showStep('details');
  });

  form.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  const trigger = dialog.dataset.trigger;
  if (trigger) {
    document.querySelectorAll<HTMLElement>(trigger).forEach((el) =>
      el.addEventListener('click', (event) => {
        event.preventDefault();
        open();
      }),
    );
  }
}
