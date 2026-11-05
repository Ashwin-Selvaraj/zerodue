'use client';

import { formatDateTime, type DeviceDto, type SmsParseResult } from '@zerodue/shared';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatINR } from '@zerodue/shared';
import { request } from '@/lib/api';
import { ui } from './ui';

interface PairingCode {
  code: string;
  expiresAt: string;
  qrPayload: { apiUrl: string; code: string };
}

/** Pair the Android companion, see paired phones, and test how a pasted message would be read. */
export function PhoneCard() {
  const [pairing, setPairing] = useState<(PairingCode & { qr: string }) | null>(null);
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await request<DeviceDto[]>('/devices'));
    } catch {
      setDevices(null); // offline: the list needs the server
    }
  }, []);
  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    if (!pairing) return;
    const tick = () => {
      const left = Math.max(0, Math.round((Date.parse(pairing.expiresAt) - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setPairing(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  async function startPairing() {
    setError(null);
    try {
      const made = await request<PairingCode>('/devices/pairing-codes', { method: 'POST' });
      const qr = await QRCode.toDataURL(JSON.stringify(made.qrPayload), { margin: 1, width: 220 });
      setPairing({ ...made, qr });
    } catch {
      setError('Could not make a pairing code. Check you are online.');
    }
  }

  async function revoke(id: string) {
    await request<void>(`/devices/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await loadDevices();
  }

  return (
    <section aria-label="Phone capture" className={ui.card + ' flex flex-col gap-3'}>
      <h2 className="font-medium">Phone capture</h2>
      <p className={ui.muted}>
        Pair the Android app to read payment messages and get a “what was this?” notification.
      </p>

      {pairing ? (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pairing.qr} alt="Pairing QR code" width={220} height={220} />
          <p className="text-2xl font-semibold tracking-widest" aria-label="Pairing code">
            {pairing.code}
          </p>
          <p className={ui.muted}>
            Scan it in the app, or type the code. Expires in {Math.floor(secondsLeft / 60)}:
            {String(secondsLeft % 60).padStart(2, '0')}.
          </p>
          <button className={ui.secondary} onClick={() => setPairing(null)}>
            Done
          </button>
        </div>
      ) : (
        <button className={ui.primary} onClick={startPairing}>
          Pair a phone
        </button>
      )}
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}

      {devices && devices.length > 0 && (
        <ul className="flex flex-col">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex min-h-14 items-center justify-between gap-2 border-t border-slate-200 text-sm dark:border-slate-800"
            >
              <span>
                <span className="block font-medium">{d.name}</span>
                <span className={ui.muted}>
                  {d.revokedAt
                    ? 'Removed'
                    : d.lastSeenAt
                      ? `Last seen ${formatDateTime(d.lastSeenAt)}`
                      : 'Never seen'}
                </span>
              </span>
              {!d.revokedAt && (
                <button className="min-h-11 px-3 underline" onClick={() => revoke(d.id)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <TryMessage />
    </section>
  );
}

const REASONS: Record<string, string> = {
  NOT_ALLOWED_SENDER: 'The sender is not on your allow-list, so the phone would skip it.',
  OTP: 'It looks like a one-time password, so it would be skipped.',
  NO_AMOUNT: 'No payment amount was found.',
  NO_DIRECTION: 'It has an amount but does not say money moved.',
};

/** Paste a message to see exactly what would be captured from it. */
function TryMessage() {
  const [result, setResult] = useState<SmsParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = String(form.get('body') ?? '').trim();
    const sender = String(form.get('sender') ?? '').trim();
    if (!body) return;
    setError(null);
    try {
      setResult(
        await request<SmsParseResult>('/ingest/parse-test', {
          method: 'POST',
          body: sender ? { body, sender } : { body },
        }),
      );
    } catch {
      setError('Could not test the message. Check you are online.');
    }
  }

  return (
    <details>
      <summary className="min-h-11 cursor-pointer py-3 text-sm underline">Test a message</summary>
      <form onSubmit={run} className="flex flex-col gap-2">
        <input
          name="sender"
          aria-label="Sender"
          className={ui.input}
          placeholder="Sender, e.g. VM-ICICIB (optional)"
        />
        <textarea
          name="body"
          aria-label="Message"
          rows={4}
          className={ui.input + ' py-3'}
          placeholder="Paste a bank message"
        />
        <button type="submit" className={ui.secondary}>
          See how it is read
        </button>
      </form>
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
      {result?.kind === 'ignored' && (
        <p className={ui.muted} role="status">
          {REASONS[result.reason]}
        </p>
      )}
      {result?.kind === 'payment' && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm" role="status">
          <dt>{result.payment.direction === 'DEBIT' ? 'Paid' : 'Received'}</dt>
          <dd>{formatINR(result.payment.amountPaise)}</dd>
          {result.payment.merchant && (
            <>
              <dt>Merchant</dt>
              <dd>{result.payment.merchant}</dd>
            </>
          )}
          {result.payment.vpa && (
            <>
              <dt>UPI address</dt>
              <dd>{result.payment.vpa}</dd>
            </>
          )}
          {result.payment.accountTail && (
            <>
              <dt>Account</dt>
              <dd>…{result.payment.accountTail}</dd>
            </>
          )}
          {result.payment.upiRef && (
            <>
              <dt>Reference</dt>
              <dd>{result.payment.upiRef}</dd>
            </>
          )}
          {result.payment.occurredAt && (
            <>
              <dt>When</dt>
              <dd>{formatDateTime(result.payment.occurredAt)}</dd>
            </>
          )}
          <dt>Confidence</dt>
          <dd>{Math.round(result.payment.confidence * 100)}%</dd>
        </dl>
      )}
    </details>
  );
}
