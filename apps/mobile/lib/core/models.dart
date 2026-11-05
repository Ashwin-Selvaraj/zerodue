import 'sms_parser.dart';

class QuickPick {
  const QuickPick(this.id, this.name);
  final String id;
  final String name;

  Map<String, Object> toJson() => {'id': id, 'name': name};
  factory QuickPick.fromJson(Map<String, Object?> json) =>
      QuickPick(json['id']! as String, json['name']! as String);
}

/// What the server says about a captured payment.
class IngestResult {
  const IngestResult({
    required this.transactionId,
    required this.type,
    required this.deduped,
    required this.status,
    required this.categoryId,
    required this.quickPicks,
    required this.title,
  });

  final String transactionId;

  /// `EXPENSE` or `INCOME`.
  final String type;

  /// The payment was already known (a retry, or the same payment in another message).
  final bool deduped;

  /// `PENDING_CATEGORY`, `POSTED` or `IGNORED`.
  final String status;
  final String? categoryId;
  final List<QuickPick> quickPicks;

  /// For the notification: "₹450 paid to SHELL".
  final String title;

  factory IngestResult.fromJson(Map<String, Object?> json) => IngestResult(
        transactionId: json['transactionId']! as String,
        type: json['type']! as String,
        deduped: json['deduped']! as bool,
        status: json['status']! as String,
        categoryId: json['categoryId'] as String?,
        quickPicks: (json['quickPicks']! as List<Object?>)
            .map((q) => QuickPick.fromJson((q! as Map).cast<String, Object?>()))
            .toList(),
        title: json['title']! as String,
      );
}

/// One payment message waiting to be sent to the server.
class PaymentEvent {
  const PaymentEvent({
    required this.clientEventId,
    required this.senderId,
    required this.receivedAt,
    required this.messageHash,
    required this.parsed,
  });

  final String clientEventId;
  final String senderId;

  /// ISO time with an offset.
  final String receivedAt;
  final String messageHash;
  final ParsedPayment parsed;

  Map<String, Object> toJson() => {
        'clientEventId': clientEventId,
        'senderId': senderId,
        'receivedAt': receivedAt,
        'messageHash': messageHash,
        'parsed': parsed.toJson(),
      };

  factory PaymentEvent.fromJson(Map<String, Object?> json) => PaymentEvent(
        clientEventId: json['clientEventId']! as String,
        senderId: json['senderId']! as String,
        receivedAt: json['receivedAt']! as String,
        messageHash: json['messageHash']! as String,
        parsed: ParsedPayment.fromJson(
            (json['parsed']! as Map).cast<String, Object?>()),
      );
}

/// What the phone remembers about being paired.
class Session {
  const Session({
    required this.apiUrl,
    required this.deviceToken,
    required this.deviceId,
    required this.salt,
    this.allowList = defaultAllowList,
    this.quickPicks = const [],
  });

  static const defaultAllowList = ['*-ICICIB', '*-ICICIT', '*-ICICIS'];

  final String apiUrl;
  final String deviceToken;
  final String deviceId;

  /// Random per install: mixed into message hashes so the server cannot recognise a message by its text alone.
  final String salt;
  final List<String> allowList;
  final List<QuickPick> quickPicks;

  Session copyWith({List<String>? allowList, List<QuickPick>? quickPicks}) =>
      Session(
        apiUrl: apiUrl,
        deviceToken: deviceToken,
        deviceId: deviceId,
        salt: salt,
        allowList: allowList ?? this.allowList,
        quickPicks: quickPicks ?? this.quickPicks,
      );

  Map<String, Object> toJson() => {
        'apiUrl': apiUrl,
        'deviceToken': deviceToken,
        'deviceId': deviceId,
        'salt': salt,
        'allowList': allowList,
        'quickPicks': quickPicks.map((q) => q.toJson()).toList(),
      };

  factory Session.fromJson(Map<String, Object?> json) => Session(
        apiUrl: json['apiUrl']! as String,
        deviceToken: json['deviceToken']! as String,
        deviceId: json['deviceId']! as String,
        salt: json['salt']! as String,
        allowList: (json['allowList'] as List<Object?>? ?? defaultAllowList)
            .cast<String>(),
        quickPicks: (json['quickPicks'] as List<Object?>? ?? [])
            .map((q) => QuickPick.fromJson((q! as Map).cast<String, Object?>()))
            .toList(),
      );
}
