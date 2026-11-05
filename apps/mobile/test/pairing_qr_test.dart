import 'package:flutter_test/flutter_test.dart';
import 'package:zerodue/core/pairing_qr.dart';

void main() {
  group('pairing QR', () {
    test('reads the address and code the web app shows', () {
      final qr = parsePairingQr(
          '{"apiUrl":"https://api.example.com","code":"AB12CD34"}');
      expect(qr?.apiUrl, 'https://api.example.com');
      expect(qr?.code, 'AB12CD34');
    });

    test('trims stray spaces and accepts a local http address', () {
      final qr = parsePairingQr(
          '{"apiUrl":" http://192.168.1.20:4000 ","code":" ab12cd34 "}');
      expect(qr?.apiUrl, 'http://192.168.1.20:4000');
      expect(qr?.code, 'ab12cd34');
    });

    test('ignores anything that is not a pairing code', () {
      for (final raw in [
        '',
        'not json',
        '[1,2]',
        '"text"',
        '{}',
        '{"apiUrl":"https://api.example.com"}',
        '{"apiUrl":5,"code":"AB12CD34"}',
        '{"apiUrl":"ftp://api.example.com","code":"AB12CD34"}',
        '{"apiUrl":"javascript:alert(1)","code":"AB12CD34"}',
        '{"apiUrl":"https://","code":"AB12CD34"}',
        '{"apiUrl":"https://api.example.com","code":"AB"}',
        '{"apiUrl":"https://api.example.com","code":"AB 12 CD 34"}',
        '{"apiUrl":"https://api.example.com","code":"../../etc/passwd"}',
      ]) {
        expect(parsePairingQr(raw), isNull, reason: raw);
      }
    });
  });
}
