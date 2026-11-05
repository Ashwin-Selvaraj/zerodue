package com.ashwin.zerodue

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // the app side of the same channel the background service uses: read what the receiver kept
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, IngestChannel.NAME)
            .setMethodCallHandler(IngestChannel.handler(applicationContext) {})
    }
}
