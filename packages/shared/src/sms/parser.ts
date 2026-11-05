import { daysInMonth } from '../finance/months';

/**
 * Reads a bank or UPI text message and says whether it is a payment, and if so what it says.
 * Pure and dependency-free so the same rules can be written out again in Dart for the Android app;
 * `fixtures.json` is the shared list of messages and expected results both implementations must pass.
 */

export type SmsChannel = 'SMS_BANK' | 'SMS_UPI';

export interface ParsedPayment {
  direction: 'DEBIT' | 'CREDIT';
  amountPaise: number;
  merchant?: string;
  vpa?: string;
  /** The last 3 or 4 digits of the account or card, as the message shows them. */
  accountTail?: string;
  upiRef?: string;
  /** When the message says the payment happened (ISO, India time); absent when it gives no date. */
  occurredAt?: string;
  channel: SmsChannel;
  /** 0 to 1: how much of a payment's usual detail was found. */
  confidence: number;
}

export type IgnoreReason = 'NOT_ALLOWED_SENDER' | 'OTP' | 'NO_AMOUNT' | 'NO_DIRECTION';

export type SmsParseResult =
  { kind: 'payment'; payment: ParsedPayment } | { kind: 'ignored'; reason: IgnoreReason };

/** Sender patterns use `*` as "anything", e.g. `*-ICICIB` matches `VM-ICICIB`. Case does not matter. */
export function senderAllowed(sender: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(sender.trim());
  });
}

const OTP = /\b(?:otp|one[- ]time password|verification code)\b/i;
const AMOUNT = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
/** An amount right after these words is a balance or limit, not the payment. */
const NOT_THE_PAYMENT = /(?:avl|avail\w*|bal\w*|limit|lmt|outstanding)[\s.:a-z]{0,12}$/i;
const DEBIT = /\b(?:debited|spent|paid|sent|withdrawn|purchase|debit)\b/i;
const CREDIT = /\b(?:credited|received|deposited|credit)\b/i;
const TAIL =
  /(?:\b(?:acct?|a\/c|account|card)\b\.?\s*(?:no\.?)?\s*[x*]*|\bending\s*(?:in\s*)?)(\d{3,4})\b/i;
const UPI_REF =
  /(?:\bupi(?:\s*ref(?:erence)?)?(?:\s*(?:no|number|id)\.?)?|\brrn|\bref(?:erence)?\s*(?:no|number)\.?)\s*[:-]?\s*(\d{9,14})\b/i;
const VPA = /\b([a-z0-9._-]{2,}@[a-z][a-z0-9]+)\b/i;
const MERCHANT_PATTERNS = [
  /[;,]\s+([A-Za-z0-9][A-Za-z0-9 &.'-]{1,38}?)\s+(?:credited|debited)\b/gi,
  /\b(?:at|to|towards|from|by|info:?)\s+(?!VPA\b)([A-Za-z0-9][A-Za-z0-9 &.'-]{1,38}?)(?=\s*(?:[.,;(]|\bon\b|\bvia\b|\bref|\bupi\b|\bavl\b|\bbal|\bis\b|$))/gi,
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE_NAMED = /\b(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/,]+(\d{2}|\d{4})\b/;
const DATE_NUMERIC = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})\b/;
const TIME = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/;

const pad = (n: number | string): string => String(n).padStart(2, '0');

function toPaise(text: string): number {
  const [rupees = '0', fraction = ''] = text.replace(/,/g, '').split('.');
  return Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
}

function findAmount(text: string): number | null {
  for (const match of text.matchAll(AMOUNT)) {
    const before = text.slice(Math.max(0, match.index - 20), match.index);
    if (!NOT_THE_PAYMENT.test(before)) return toPaise(match[1]!);
  }
  return null;
}

/** "your account", "ICICI Bank Acct ending 4567" and the like describe the account, not who was paid. */
const NOT_A_MERCHANT = /\b(?:your|acct?|a\/c|account|card|bank|ending|vpa)\b/i;

function findMerchant(text: string): string | undefined {
  for (const pattern of MERCHANT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const found = match[1]!.trim().replace(/[\s.-]+$/, '');
      if (found.length >= 2 && !NOT_A_MERCHANT.test(found)) return found.replace(/\s+/g, ' ');
    }
  }
  return undefined;
}

/** The date (and time, if given) in the message as an ISO string in India time. */
function findWhen(text: string): string | undefined {
  let year: number;
  let month: number;
  let day: number;
  const named = DATE_NAMED.exec(text);
  const numeric = named ? null : DATE_NUMERIC.exec(text);
  if (named) {
    month = MONTHS.indexOf(named[2]!.toLowerCase()) + 1;
    if (month === 0) return undefined;
    day = Number(named[1]);
    year = Number(named[3]);
  } else if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    year = Number(numeric[3]);
  } else {
    return undefined;
  }
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(`${year}-${pad(month)}-01`)) {
    return undefined;
  }
  const time = TIME.exec(text);
  const clock = time ? `${pad(time[1]!)}:${time[2]}:${time[3] ?? '00'}` : '12:00:00';
  return `${year}-${pad(month)}-${pad(day)}T${clock}+05:30`;
}

export function parseSms(body: string): SmsParseResult {
  const text = body.replace(/\s+/g, ' ').trim();
  if (OTP.test(text)) return { kind: 'ignored', reason: 'OTP' };

  const amountPaise = findAmount(text);
  if (amountPaise === null || amountPaise === 0) return { kind: 'ignored', reason: 'NO_AMOUNT' };

  // "debited for Rs 450; SHELL credited" mentions both: the first verb is about your account
  const debit = DEBIT.exec(text)?.index ?? Infinity;
  const credit = CREDIT.exec(text)?.index ?? Infinity;
  if (debit === Infinity && credit === Infinity) return { kind: 'ignored', reason: 'NO_DIRECTION' };

  const upiRef = UPI_REF.exec(text)?.[1];
  const vpa = VPA.exec(text)?.[1]?.toLowerCase();
  const merchant = findMerchant(text);
  const payment: ParsedPayment = {
    direction: debit < credit ? 'DEBIT' : 'CREDIT',
    amountPaise,
    channel: upiRef || vpa || /\bupi\b/i.test(text) ? 'SMS_UPI' : 'SMS_BANK',
    confidence: 0.5 + 0.2 + (merchant || vpa ? 0.15 : 0) + (upiRef ? 0.15 : 0),
  };
  if (merchant) payment.merchant = merchant;
  if (vpa) payment.vpa = vpa;
  const tail = TAIL.exec(text)?.[1];
  if (tail) payment.accountTail = tail;
  if (upiRef) payment.upiRef = upiRef;
  const occurredAt = findWhen(text);
  if (occurredAt) payment.occurredAt = occurredAt;
  payment.confidence = Math.round(payment.confidence * 100) / 100;
  return { kind: 'payment', payment };
}

/** Allow-list check first, then {@link parseSms}. This is what the phone runs on every message. */
export function readSms(sender: string, body: string, allowList: string[]): SmsParseResult {
  if (!senderAllowed(sender, allowList)) return { kind: 'ignored', reason: 'NOT_ALLOWED_SENDER' };
  return parseSms(body);
}
