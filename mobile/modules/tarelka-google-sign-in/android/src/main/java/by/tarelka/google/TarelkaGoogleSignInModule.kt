package by.tarelka.google

import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TarelkaGoogleSignInModule : Module() {
  private var pending: CancellationSignal? = null

  override fun definition() = ModuleDefinition {
    Name("TarelkaGoogleSignIn")

    AsyncFunction("signIn") { clientId: String, nonce: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || clientId.isBlank() || nonce.isBlank()) {
        promise.reject("GOOGLE_UNAVAILABLE", "Вход через Google временно недоступен", null)
      } else if (pending != null) {
        promise.reject("GOOGLE_BUSY", "Вход через Google уже выполняется", null)
      } else {
        val signal = CancellationSignal()
        pending = signal
        try {
          // The explicit button flow also lets a user add an account to the device.
          val option = GetSignInWithGoogleOption.Builder(clientId).setNonce(nonce).build()
          val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
          CredentialManager.create(activity).getCredentialAsync(
            activity, request, signal, ContextCompat.getMainExecutor(activity),
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
              override fun onResult(result: GetCredentialResponse) {
                pending = null
                try {
                  val credential = result.credential
                  if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    promise.reject("GOOGLE_INVALID_RESPONSE", "Не удалось подтвердить аккаунт Google", null)
                    return
                  }
                  promise.resolve(GoogleIdTokenCredential.createFrom(credential.data).idToken)
                } catch (_: Exception) {
                  promise.reject("GOOGLE_INVALID_RESPONSE", "Не удалось подтвердить аккаунт Google", null)
                }
              }

              override fun onError(error: GetCredentialException) {
                pending = null
                if (error is GetCredentialCancellationException) promise.resolve(null)
                else promise.reject("GOOGLE_SIGN_IN_FAILED", "Не удалось войти через Google. Попробуйте ещё раз.", null)
              }
            }
          )
        } catch (_: Exception) {
          pending = null
          promise.reject("GOOGLE_UNAVAILABLE", "Вход через Google временно недоступен", null)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("signOut") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) promise.resolve(null)
      else {
        try {
          CredentialManager.create(context).clearCredentialStateAsync(
            ClearCredentialStateRequest(), null, ContextCompat.getMainExecutor(context),
            object : CredentialManagerCallback<Void?, ClearCredentialException> {
              override fun onResult(result: Void?) { promise.resolve(null) }
              override fun onError(error: ClearCredentialException) { promise.resolve(null) }
            }
          )
        } catch (_: Exception) { promise.resolve(null) }
      }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      pending?.cancel()
      pending = null
    }
  }
}
