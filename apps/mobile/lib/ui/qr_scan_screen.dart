import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../core/pairing_qr.dart';

/// Opens the camera and returns the text of the first ZeroDue pairing QR code it sees.
typedef QrScanner = Future<String?> Function(BuildContext context);

Future<String?> scanPairingQr(BuildContext context) =>
    Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const QrScanScreen()),
    );

class QrScanScreen extends StatefulWidget {
  const QrScanScreen({super.key});

  @override
  State<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<QrScanScreen> {
  bool _done = false;

  void _onDetect(BarcodeCapture capture) {
    if (_done) return;
    for (final barcode in capture.barcodes) {
      final text = barcode.rawValue;
      if (text != null && parsePairingQr(text) != null) {
        _done = true;
        Navigator.of(context).pop(text);
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan the pairing code')),
      body: Stack(
        children: [
          MobileScanner(
            onDetect: _onDetect,
            errorBuilder: (context, error) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  error.errorCode == MobileScannerErrorCode.permissionDenied
                      ? 'The camera is not allowed. Allow it in Android settings, or go back and type the code instead.'
                      : 'The camera could not start. Go back and type the code instead.',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ),
          const Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'Point the camera at the code in More → Phone capture on the web app.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white, shadows: [
                  Shadow(blurRadius: 4, color: Colors.black),
                ]),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
