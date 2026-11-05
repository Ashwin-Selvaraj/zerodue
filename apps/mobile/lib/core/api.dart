import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

/// The server answered with an error.
class ApiException implements Exception {
  ApiException(this.status, this.message, [this.body]);
  final int status;
  final String message;
  final Map<String, Object?>? body;

  /// This phone's token is no longer accepted: it was removed in the web app.
  bool get revoked => status == 401;

  /// The payment was already categorised differently; the category it has now.
  String? get currentCategoryId => body?['currentCategoryId'] as String?;

  @override
  String toString() => 'ApiException($status): $message';
}

/// The server could not be reached.
class OfflineException implements Exception {
  @override
  String toString() => 'OfflineException';
}

/// Talks to the ZeroDue server as a paired phone.
class ApiClient {
  ApiClient(this.baseUrl, {this.token, http.Client? client})
      : _client = client ?? http.Client();

  final String baseUrl;
  final String? token;
  final http.Client _client;

  static String clean(String url) {
    final trimmed = url.trim().replaceAll(RegExp(r'/+$'), '');
    return trimmed.contains('://') ? trimmed : 'https://$trimmed';
  }

  Future<Map<String, Object?>> _send(String method, String path,
      [Object? body]) async {
    final request = http.Request(method, Uri.parse('${clean(baseUrl)}$path'))
      ..headers['Accept'] = 'application/json';
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final http.Response response;
    try {
      response = await http.Response.fromStream(
        await _client.send(request).timeout(const Duration(seconds: 20)),
      );
    } on TimeoutException {
      throw OfflineException();
    } on http.ClientException {
      throw OfflineException();
    } on FormatException {
      throw OfflineException();
    }
    Map<String, Object?>? parsed;
    try {
      final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
      parsed =
          decoded is Map ? decoded.cast<String, Object?>() : {'items': decoded};
    } on FormatException {
      parsed = null;
    }
    if (response.statusCode >= 400) {
      final message = parsed?['message'];
      throw ApiException(
        response.statusCode,
        message is String ? message : 'Request failed (${response.statusCode})',
        parsed,
      );
    }
    return parsed ?? {};
  }

  /// Trades the code shown in the web app for this phone's token.
  Future<({String deviceId, String deviceToken})> pair(
      String code, String deviceName) async {
    final json = await _send('POST', '/devices/pair',
        {'code': code.trim(), 'deviceName': deviceName});
    return (
      deviceId: json['deviceId']! as String,
      deviceToken: json['deviceToken']! as String
    );
  }

  /// The sender allow-list and the category buttons for the notification.
  Future<({List<String> allowList, List<QuickPick> quickPicks})>
      config() async {
    final json = await _send('GET', '/ingest/config');
    return (
      allowList: (json['allowList']! as List<Object?>).cast<String>(),
      quickPicks: (json['quickPicks']! as List<Object?>)
          .map((q) => QuickPick.fromJson((q! as Map).cast<String, Object?>()))
          .toList(),
    );
  }

  Future<IngestResult> ingest(PaymentEvent event) async =>
      IngestResult.fromJson(await _send('POST', '/ingest/sms', event.toJson()));

  /// First answer wins: a different earlier answer throws an [ApiException] with status 409.
  Future<void> categorise(String transactionId, String categoryId,
      {bool createRule = false}) async {
    await _send('POST', '/transactions/$transactionId/categorise', {
      'categoryId': categoryId,
      'via': 'FLUTTER',
      'createRule': createRule,
    });
  }

  Future<void> ignore(String transactionId) async {
    await _send('POST', '/transactions/$transactionId/ignore');
  }

  /// Captured payments still waiting for a category.
  Future<List<Map<String, Object?>>> uncategorised() async {
    final json = await _send('GET', '/transactions/uncategorised');
    return (json['items']! as List<Object?>)
        .map((t) => (t! as Map).cast<String, Object?>())
        .toList();
  }
}
