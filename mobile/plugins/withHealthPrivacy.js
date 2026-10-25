const { AndroidConfig, withAndroidManifest, withDangerousMod, withGradleProperties } = require('@expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Keep Health Connect's privacy entry point available without React, auth or network.
module.exports = function withHealthPrivacy(config) {
  config = withGradleProperties(config, config => {
    const property = config.modResults.find(item => item.type === 'property' && item.key === 'android.minSdkVersion');
    if (property) property.value = String(Math.max(26, Number(property.value) || 26));
    else config.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '26' });
    return config;
  });
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest.queries ??= [];
    if (!manifest.queries.some(q => q.package?.some(p => p.$['android:name'] === 'com.google.android.apps.healthdata'))) {
      manifest.queries.push({ package: [{ $: { 'android:name': 'com.google.android.apps.healthdata' } }] });
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    main['intent-filter'] = (main['intent-filter'] ?? []).filter(f => !f.action?.some(a => a.$['android:name'] === 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE'));
    app.activity ??= [];
    if (!app.activity.some(a => a.$['android:name'] === '.HealthPermissionsActivity')) app.activity.push({
      $: { 'android:name': '.HealthPermissionsActivity', 'android:exported': 'true', 'android:label': 'Данные здоровья · ТАРЕЛКА' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE' } }] }],
    });
    app['activity-alias'] ??= [];
    if (!app['activity-alias'].some(a => a.$['android:name'] === 'ViewPermissionUsageActivity')) app['activity-alias'].push({
      $: { 'android:name': 'ViewPermissionUsageActivity', 'android:exported': 'true', 'android:targetActivity': '.HealthPermissionsActivity', 'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }], category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }] }],
    });
    for (const alias of app['activity-alias'] ?? []) {
      if (alias.$['android:name'] === 'ViewPermissionUsageActivity') alias.$['android:targetActivity'] = '.HealthPermissionsActivity';
    }
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const packageName = config.android.package;
    const folder = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java', ...packageName.split('.'));
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'HealthPermissionsActivity.kt'), `package ${packageName}

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Button

class HealthPermissionsActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val padding = (24 * resources.displayMetrics.density).toInt()
    val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(padding, padding, padding, padding) }
    content.addView(TextView(this).apply {
      text = "ТАРЕЛКА и данные здоровья"; textSize = 24f; setTextColor(0xff20382a.toInt())
    })
    content.addView(TextView(this).apply {
      text = "С вашего разрешения ТАРЕЛКА читает шаги, расстояние, активные калории, тренировки и вес из Health Connect. Вы выбираете доступные типы в системном окне.\\n\\nДневные итоги, тренировки, измерения веса и названия источников сохраняются на сервере в вашем аккаунте, чтобы показывать дневник и статистику. Подробные записи шагов не отправляются. Данные Health Connect не передаются AI-провайдерам и не используются для рекламы.\\n\\nКалории с устройств не увеличивают норму питания, а измерения веса не меняют профиль автоматически. Мы не записываем данные обратно в Health Connect.\\n\\nСинхронизация работает, пока приложение открыто. Доступ можно отозвать в Health Connect. В разделе «Устройства и здоровье» можно отключить синхронизацию или отдельно удалить импортированную историю. Отключение сохраняет историю в аккаунте; удаление не затрагивает оригиналы в Health Connect."
      textSize = 16f; setPadding(0, padding, 0, padding)
    })
    content.addView(Button(this).apply { text = "Политика конфиденциальности"; setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://tarelkaa.by/privacy.html"))) } })
    content.addView(Button(this).apply { text = "Закрыть"; setOnClickListener { finish() } })
    setContentView(ScrollView(this).apply { addView(content) })
  }
}
`);
    return config;
  }]);
};
