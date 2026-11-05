package com.ashwin.zerodue

import android.content.Context
import io.flutter.plugin.common.MethodChannel

/** The calls the Dart side can make to the native queue. Shared by the app and the background service. */
object IngestChannel {
    const val NAME = "zerodue/ingest"

    fun handler(context: Context, onDone: () -> Unit) = MethodChannel.MethodCallHandler { call, result ->
        when (call.method) {
            "take" -> result.success(NativeQueue.take(context))
            "setAllowList" -> {
                val patterns = (call.arguments as? List<*>)?.filterIsInstance<String>() ?: emptyList()
                NativeQueue.setAllowList(context, patterns)
                result.success(null)
            }
            "done" -> {
                result.success(null)
                onDone()
            }
            else -> result.notImplemented()
        }
    }
}
