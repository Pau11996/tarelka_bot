import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import type { Favorite } from "../types";
import { Field, PrimaryButton } from "../ui";

export function FavoriteCorrectionForm({ item, value, onChange, onSubmit, disabled, label }: {
  item: Favorite;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  label: string;
}) {
  return <View style={s.section}>
    <Text accessibilityRole="header" style={s.title}>Уточнить избранное</Text>
    <Text style={s.hint}>Изменится сохранённая порция. Прошлые записи дневника останутся прежними.</Text>
    <Field
      value={value} onChangeText={onChange} editable={!disabled} multiline maxLength={2000}
      accessibilityLabel="Что изменить в избранном"
      placeholder={item.entry_type === "water" ? "Например: 500 мл" : item.entry_type === "activity" ? "Например: прогулка 45 минут" : "Например: порция 300 г вместо 250 г"}
      style={s.input}
    />
    <PrimaryButton label={label} disabled={disabled} onPress={onSubmit} />
  </View>;
}

const s = StyleSheet.create({
  section: { gap: 12, marginTop: 10 },
  title: { color: colors.text, fontSize: 17, fontWeight: "600" },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  input: { minHeight: 80, textAlignVertical: "top" },
});
