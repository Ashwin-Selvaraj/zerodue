/// Reads a bank or UPI text message and says whether it is a payment, and if so what it says.
///
/// This is a line-for-line copy of `packages/shared/src/sms/parser.ts`. Both must pass the same
/// `fixtures.json`, so a change to one needs the same change in the other.
library;

class ParsedPayment {
  ParsedPayment({
    required this.direction,
    required this.amountPaise,
    required this.channel,
    required this.confidence,
    this.merchant,
    this.vpa,
    this.accountTail,
    this.upiRef,
    this.occurredAt,
  });

  /// `DEBIT` or `CREDIT`.
  final String direction;
  final int amountPaise;

  /// `SMS_BANK` or `SMS_UPI`.
  final String channel;
  final double confidence;
  final String? merchant;
  final String? vpa;

  /// The last 3 or 4 digits of the account or card, as the message shows them.
  final String? accountTail;
  final String? upiRef;

  /// ISO time in India time, when the message gives a date.
  final String? occurredAt;

  Map<String, Object> toJson() => {
        'direction': direction,
        'amountPaise': amountPaise,
        'channel': channel,
        'confidence': confidence,
        if (merchant != null) 'merchant': merchant!,
        if (vpa != null) 'vpa': vpa!,
        if (accountTail != null) 'accountTail': accountTail!,
        if (upiRef != null) 'upiRef': upiRef!,
        if (occurredAt != null) 'occurredAt': occurredAt!,
      };

  factory ParsedPayment.fromJson(Map<String, Object?> json) => ParsedPayment(
        direction: json['direction']! as String,
        amountPaise: json['amountPaise']! as int,
        channel: json['channel']! as String,
        confidence: (json['confidence']! as num).toDouble(),
        merchant: json['merchant'] as String?,
        vpa: json['vpa'] as String?,
        accountTail: json['accountTail'] as String?,
        upiRef: json['upiRef'] as String?,
        occurredAt: json['occurredAt'] as String?,
      );
}

/// Why a message was skipped.
enum IgnoreReason { notAllowedSender, otp, noAmount, noDirection }

extension IgnoreReasonCode on IgnoreReason {
  /// The same names the TypeScript reader uses.
  String get code => switch (this) {
        IgnoreReason.notAllowedSender => 'NOT_ALLOWED_SENDER',
        IgnoreReason.otp => 'OTP',
        IgnoreReason.noAmount => 'NO_AMOUNT',
        IgnoreReason.noDirection => 'NO_DIRECTION',
      };

  String get explanation => switch (this) {
        IgnoreReason.notAllowedSender =>
          'The sender is not on your allow-list, so it would be skipped.',
        IgnoreReason.otp =>
          'It looks like a one-time password, so it would be skipped.',
        IgnoreReason.noAmount => 'No payment amount was found.',
        IgnoreReason.noDirection =>
          'It has an amount but does not say money moved.',
      };
}

/// Either a payment or the reason the message was skipped.
class SmsReading {
  const SmsReading.payment(ParsedPayment this.payment) : ignored = null;
  const SmsReading.ignored(IgnoreReason this.ignored) : payment = null;

  final ParsedPayment? payment;
  final IgnoreReason? ignored;
}

/// Sender patterns use `*` as "anything", e.g. `*-ICICIB` matches `VM-ICICIB`. Case does not matter.
bool senderAllowed(String sender, List<String> patterns) {
  return patterns.any((pattern) {
    final escaped = RegExp.escape(pattern).replaceAll(r'\*', '.*');
    return RegExp('^$escaped\$', caseSensitive: false).hasMatch(sender.trim());
  });
}

final _otp = RegExp(r'\b(?:otp|one[- ]time password|verification code)\b',
    caseSensitive: false);
final _amount =
    RegExp(r'(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)', caseSensitive: false);

/// An amount right after these words is a balance or limit, not the payment.
final _notThePayment = RegExp(
  r'(?:avl|avail\w*|bal\w*|limit|lmt|outstanding)[\s.:a-z]{0,12}$',
  caseSensitive: false,
);
final _debit = RegExp(
    r'\b(?:debited|spent|paid|sent|withdrawn|purchase|debit)\b',
    caseSensitive: false);
final _credit =
    RegExp(r'\b(?:credited|received|deposited|credit)\b', caseSensitive: false);
final _tail = RegExp(
  r'(?:\b(?:acct?|a/c|account|card)\b\.?\s*(?:no\.?)?\s*[x*]*|\bending\s*(?:in\s*)?)(\d{3,4})\b',
  caseSensitive: false,
);
final _upiRef = RegExp(
  r'(?:\bupi(?:\s*ref(?:erence)?)?(?:\s*(?:no|number|id)\.?)?|\brrn|\bref(?:erence)?\s*(?:no|number)\.?)\s*[:-]?\s*(\d{9,14})\b',
  caseSensitive: false,
);
final _vpa =
    RegExp(r'\b([a-z0-9._-]{2,}@[a-z][a-z0-9]+)\b', caseSensitive: false);
final _merchantPatterns = [
  RegExp(
      r"[;,]\s+([A-Za-z0-9][A-Za-z0-9 &.'-]{1,38}?)\s+(?:credited|debited)\b",
      caseSensitive: false),
  RegExp(
    r"\b(?:at|to|towards|from|by|info:?)\s+(?!VPA\b)([A-Za-z0-9][A-Za-z0-9 &.'-]{1,38}?)(?=\s*(?:[.,;(]|\bon\b|\bvia\b|\bref|\bupi\b|\bavl\b|\bbal|\bis\b|$))",
    caseSensitive: false,
  ),
];

/// "your account", "ICICI Bank Acct ending 4567" and the like describe the account, not who was paid.
final _notAMerchant = RegExp(
  r'\b(?:your|acct?|a/c|account|card|bank|ending|vpa)\b',
  caseSensitive: false,
);
const _months = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec'
];
final _dateNamed =
    RegExp(r'\b(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/,]+(\d{2}|\d{4})\b');
final _dateNumeric = RegExp(r'\b(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})\b');
final _time = RegExp(r'\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b');

String _pad(Object n) => n.toString().padLeft(2, '0');

int _toPaise(String text) {
  final parts = text.replaceAll(',', '').split('.');
  final rupees = int.parse(parts[0].isEmpty ? '0' : parts[0]);
  final fraction = parts.length > 1 ? parts[1].padRight(2, '0') : '00';
  return rupees * 100 + int.parse(fraction);
}

int? _findAmount(String text) {
  for (final match in _amount.allMatches(text)) {
    final before = text.substring(
        match.start - 20 < 0 ? 0 : match.start - 20, match.start);
    if (!_notThePayment.hasMatch(before)) return _toPaise(match.group(1)!);
  }
  return null;
}

String? _findMerchant(String text) {
  for (final pattern in _merchantPatterns) {
    for (final match in pattern.allMatches(text)) {
      final found = match.group(1)!.trim().replaceAll(RegExp(r'[\s.-]+$'), '');
      if (found.length >= 2 && !_notAMerchant.hasMatch(found)) {
        return found.replaceAll(RegExp(r'\s+'), ' ');
      }
    }
  }
  return null;
}

/// The date (and time, if given) in the message as an ISO string in India time.
String? _findWhen(String text) {
  int year;
  int month;
  int day;
  final named = _dateNamed.firstMatch(text);
  final numeric = named == null ? _dateNumeric.firstMatch(text) : null;
  if (named != null) {
    month = _months.indexOf(named.group(2)!.toLowerCase()) + 1;
    if (month == 0) return null;
    day = int.parse(named.group(1)!);
    year = int.parse(named.group(3)!);
  } else if (numeric != null) {
    day = int.parse(numeric.group(1)!);
    month = int.parse(numeric.group(2)!);
    year = int.parse(numeric.group(3)!);
  } else {
    return null;
  }
  if (year < 100) year += 2000;
  if (month < 1 ||
      month > 12 ||
      day < 1 ||
      day > DateTime(year, month + 1, 0).day) {
    return null;
  }
  final time = _time.firstMatch(text);
  final clock = time == null
      ? '12:00:00'
      : '${_pad(time.group(1)!)}:${time.group(2)}:${time.group(3) ?? '00'}';
  return '$year-${_pad(month)}-${_pad(day)}T$clock+05:30';
}

/// Reads one message body. See also [readSms], which checks the sender first.
SmsReading parseSms(String body) {
  final text = body.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (_otp.hasMatch(text)) return const SmsReading.ignored(IgnoreReason.otp);

  final amountPaise = _findAmount(text);
  if (amountPaise == null || amountPaise == 0) {
    return const SmsReading.ignored(IgnoreReason.noAmount);
  }

  // "debited for Rs 450; SHELL credited" mentions both: the first verb is about your account
  final debit = _debit.firstMatch(text)?.start;
  final credit = _credit.firstMatch(text)?.start;
  if (debit == null && credit == null) {
    return const SmsReading.ignored(IgnoreReason.noDirection);
  }

  final upiRef = _upiRef.firstMatch(text)?.group(1);
  final vpa = _vpa.firstMatch(text)?.group(1)?.toLowerCase();
  final merchant = _findMerchant(text);
  final confidence = 0.5 +
      0.2 +
      (merchant != null || vpa != null ? 0.15 : 0) +
      (upiRef != null ? 0.15 : 0);
  final isDebit = credit == null || (debit != null && debit < credit);
  return SmsReading.payment(
    ParsedPayment(
      direction: isDebit ? 'DEBIT' : 'CREDIT',
      amountPaise: amountPaise,
      channel: upiRef != null ||
              vpa != null ||
              RegExp(r'\bupi\b', caseSensitive: false).hasMatch(text)
          ? 'SMS_UPI'
          : 'SMS_BANK',
      confidence: (confidence * 100).round() / 100,
      merchant: merchant,
      vpa: vpa,
      accountTail: _tail.firstMatch(text)?.group(1),
      upiRef: upiRef,
      occurredAt: _findWhen(text),
    ),
  );
}

/// Allow-list check first, then [parseSms]. This is what runs on every message.
SmsReading readSms(String sender, String body, List<String> allowList) {
  if (!senderAllowed(sender, allowList)) {
    return const SmsReading.ignored(IgnoreReason.notAllowedSender);
  }
  return parseSms(body);
}
