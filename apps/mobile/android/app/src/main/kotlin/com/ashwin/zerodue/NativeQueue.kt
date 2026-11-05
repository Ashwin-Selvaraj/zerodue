package com.ashwin.zerodue

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Holds bank messages between the moment the receiver catches them and the moment the Dart side
 * reads them, so nothing is lost if the app is not running. Also remembers which senders to keep.
 */
object NativeQueue {
    private const val PREFS = "zerodue_native"
    private const val PENDING = "pending"
    private const val ALLOW = "allow"

    /** Used until the app has fetched your own list from the server. */
    private val DEFAULT_ALLOW = listOf("*-ICICIB", "*-ICICIT", "*-ICICIS")

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun add(context: Context, sender: String, body: String, receivedAt: Long) {
        val list = JSONArray(prefs(context).getString(PENDING, "[]"))
        list.put(
            JSONObject()
                .put("sender", sender)
                .put("body", body)
                .put("receivedAt", receivedAt),
        )
        prefs(context).edit().putString(PENDING, list.toString()).apply()
    }

    /** Hands over everything waiting and empties the queue. */
    @Synchronized
    fun take(context: Context): List<Map<String, Any>> {
        val list = JSONArray(prefs(context).getString(PENDING, "[]"))
        prefs(context).edit().putString(PENDING, "[]").apply()
        return (0 until list.length()).map { i ->
            val item = list.getJSONObject(i)
            mapOf(
                "sender" to item.getString("sender"),
                "body" to item.getString("body"),
                "receivedAt" to item.getLong("receivedAt"),
            )
        }
    }

    @Synchronized
    fun hasPending(context: Context): Boolean =
        JSONArray(prefs(context).getString(PENDING, "[]")).length() > 0

    @Synchronized
    fun setAllowList(context: Context, patterns: List<String>) {
        prefs(context).edit().putString(ALLOW, JSONArray(patterns).toString()).apply()
    }

    private fun allowList(context: Context): List<String> {
        val saved = prefs(context).getString(ALLOW, null) ?: return DEFAULT_ALLOW
        val list = JSONArray(saved)
        return (0 until list.length()).map { list.getString(it) }
    }

    /** `*` matches anything, case does not matter: the same rule the Dart and web readers use. */
    fun allowed(context: Context, sender: String): Boolean = allowList(context).any { pattern ->
        val regex = pattern.split("*").joinToString(".*") { Regex.escape(it) }
        Regex("^$regex$", RegexOption.IGNORE_CASE).matches(sender.trim())
    }
}
