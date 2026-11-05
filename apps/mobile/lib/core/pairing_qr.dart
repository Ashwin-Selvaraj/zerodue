import 'dart:convert';

/// What the web app's pairing QR carries: where the server is, and the one-time code.
class PairingQr {
  const PairingQr(this.apiUrl, this.code);
  final String apiUrl;
  final String code;
}

/// Reads the text of a scanned QR code, or returns null if it is not a ZeroDue pairing code
/// (so a stray QR code in view is ignored rather than trusted).
PairingQr? parsePairingQr(String raw) {
  final Object? decoded;
  try {
    decoded = jsonDecode(raw);
  } on FormatException {
    return null;
  }
  if (decoded is! Map) return null;
  final apiUrl = decoded['apiUrl'];
  final code = decoded['code'];
  if (apiUrl is! String || code is! String) return null;
  final uri = Uri.tryParse(apiUrl.trim());
  if (uri == null ||
      !(uri.scheme == 'http' || uri.scheme == 'https') ||
      uri.host.isEmpty) {
    return null;
  }
  final cleanCode = code.trim();
  if (!RegExp(r'^[A-Za-z0-9]{4,16}$').hasMatch(cleanCode)) return null;
  return PairingQr(apiUrl.trim(), cleanCode);
}
