package by.tarelka.billing

import android.os.Handler
import android.os.Looper
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.GetBillingConfigParams
import com.android.billingclient.api.PendingPurchasesParams
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** A fresh Play-country query for each visit; no location, locale or persisted profile data. */
class TarelkaPlayBillingModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val requests = mutableSetOf<CountryRequest>()

  override fun definition() = ModuleDefinition {
    Name("TarelkaPlayBilling")

    AsyncFunction("getCountryCode") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("PLAY_UNAVAILABLE", "Google Play недоступен", null)
      } else {
        val request = CountryRequest(promise)
        request.client = BillingClient.newBuilder(context.applicationContext)
          .setListener { _, _ -> }
          .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
          .build()
        requests.add(request)
        request.start()
      }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      handler.post { requests.toList().forEach { it.finish(null) } }
    }
  }

  private inner class CountryRequest(private val promise: Promise) : BillingClientStateListener {
    lateinit var client: BillingClient
    private var settled = false
    private val timeout = Runnable { finish(null) }

    fun start() {
      handler.postDelayed(timeout, 15_000)
      try {
        client.startConnection(this)
      } catch (_: Exception) {
        finish(null)
      }
    }

    override fun onBillingSetupFinished(result: BillingResult) {
      handler.post {
        if (!settled) {
          if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            finish(null)
          } else {
            try {
              client.getBillingConfigAsync(GetBillingConfigParams.newBuilder().build()) { response, config ->
                handler.post {
                  finish(if (response.responseCode == BillingClient.BillingResponseCode.OK) config?.countryCode else null)
                }
              }
            } catch (_: Exception) {
              finish(null)
            }
          }
        }
      }
    }

    override fun onBillingServiceDisconnected() {
      handler.post { finish(null) }
    }

    fun finish(country: String?) {
      if (settled) return
      settled = true
      handler.removeCallbacks(timeout)
      requests.remove(this)
      try { client.endConnection() } catch (_: Exception) { }
      if (country != null && Regex("[A-Z]{2}").matches(country)) {
        promise.resolve(country)
      } else {
        promise.reject("PLAY_COUNTRY_UNAVAILABLE", "Не удалось проверить доступность подписки в Google Play", null)
      }
    }
  }
}
