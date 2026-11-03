import 'package:flutter/material.dart';

const appName = 'ZeroDue';
const appTagline = 'Track every rupee. Clear every loan.';

void main() => runApp(const ZeroDueApp());

class ZeroDueApp extends StatelessWidget {
  const ZeroDueApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: appName,
      theme: ThemeData(colorSchemeSeed: const Color(0xFF0F766E), useMaterial3: true),
      darkTheme: ThemeData(
        colorSchemeSeed: const Color(0xFF0F766E),
        brightness: Brightness.dark,
        useMaterial3: true,
      ),
      home: const Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(appName, style: TextStyle(fontSize: 32, fontWeight: FontWeight.w600)),
              SizedBox(height: 8),
              Text(appTagline),
            ],
          ),
        ),
      ),
    );
  }
}
