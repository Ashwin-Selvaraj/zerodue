package com.ashwin.zerodue

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel

/**
 * Reads the messages the receiver kept. Starts a Flutter engine with no screen that runs the Dart
 * `ingestMain` (parse, send, show the "what type of payment?" notification), and stops itself when
 * Dart says it is done, or after a minute and a half at most.
 */
class IngestService : Service() {
    private var engine: FlutterEngine? = null
    private val handler = Handler(Looper.getMainLooper())
    private val timeout = Runnable { stopWork() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startAsForeground()
        if (engine == null) startEngine()
        handler.removeCallbacks(timeout)
        handler.postDelayed(timeout, TIMEOUT_MS)
        return START_NOT_STICKY
    }

    private fun startAsForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Reading payment messages", NotificationManager.IMPORTANCE_MIN),
            )
        }
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("ZeroDue")
            .setContentText("Reading a payment message")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startEngine() {
        val loader = FlutterInjector.instance().flutterLoader()
        loader.startInitialization(applicationContext)
        loader.ensureInitializationComplete(applicationContext, null)

        val newEngine = FlutterEngine(applicationContext)
        MethodChannel(newEngine.dartExecutor.binaryMessenger, IngestChannel.NAME)
            .setMethodCallHandler(IngestChannel.handler(applicationContext) { onDartDone() })
        newEngine.dartExecutor.executeDartEntrypoint(
            DartExecutor.DartEntrypoint(loader.findAppBundlePath(), "ingestMain"),
        )
        engine = newEngine
    }

    /** Dart has handled what it took. If more arrived meanwhile, run it again rather than lose them. */
    private fun onDartDone() {
        handler.post {
            if (NativeQueue.hasPending(applicationContext)) {
                destroyEngine()
                startEngine()
            } else {
                stopWork()
            }
        }
    }

    private fun destroyEngine() {
        engine?.destroy()
        engine = null
    }

    private fun stopWork() {
        handler.removeCallbacks(timeout)
        destroyEngine()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacks(timeout)
        destroyEngine()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "capture_service"
        private const val NOTIFICATION_ID = 4101
        private const val TIMEOUT_MS = 90_000L
    }
}
