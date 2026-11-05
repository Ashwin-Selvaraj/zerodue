package com.ashwin.zerodue

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Wakes when a text message arrives. Messages from senders you have not allowed are dropped here,
 * unread. The rest are kept in [NativeQueue] and the ingest service is started to read them.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return

        // a long message arrives in parts: join the parts from each sender
        val bySender = LinkedHashMap<String, StringBuilder>()
        var receivedAt = System.currentTimeMillis()
        for (part in messages) {
            val sender = part.originatingAddress ?: continue
            bySender.getOrPut(sender) { StringBuilder() }.append(part.messageBody ?: "")
            receivedAt = part.timestampMillis
        }

        var kept = false
        for ((sender, body) in bySender) {
            if (!NativeQueue.allowed(context, sender)) continue
            NativeQueue.add(context, sender, body.toString(), receivedAt)
            kept = true
        }
        if (!kept) return

        try {
            ContextCompat.startForegroundService(context, Intent(context, IngestService::class.java))
        } catch (e: Exception) {
            // Android refused to start the service from the background (battery restrictions).
            // The message stays queued and is read the next time the app is opened.
            Log.w("ZeroDue", "Could not start the ingest service: ${e.javaClass.simpleName}")
        }
    }
}
