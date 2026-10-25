import { useState } from "react";
import { Text } from "react-native";
import { Panel, Segments, State, design } from "./Screen";
import { Field, PrimaryButton } from "../ui";
import { useAuth } from "../auth";
import { api, apiFailureMessage } from "../api";
export function FeedbackForm() {
  const { token, signOut } = useAuth();
  const [rating, setRating] = useState(5),
    [photo, setPhoto] = useState(0),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function send() {
    if (busy) return;
    setBusy(true);
    try {
      await api("/v1/feedback", {
        token,
        method: "POST",
        json: {
          app_rating: rating,
          photo_rating: photo || null,
          feedback_text: text.trim() || null,
        },
      });
      setSent(true);
    } catch (e) {
      setError(
        await apiFailureMessage(e, "Не удалось отправить отзыв", signOut),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Как вам Тарелка?">
      {sent ? (
        <Text style={design.subtitle}>Спасибо! Ваш ответ сохранён.</Text>
      ) : (
        <>
          <Text style={design.subtitle}>Общее впечатление · от 1 до 5</Text>
          <Segments
            value={rating}
            onChange={setRating}
            items={[1, 2, 3, 4, 5].map((value) => ({
              value,
              label: String(value),
            }))}
          />
          <Text style={design.subtitle}>
            Распознавание фото · необязательно
          </Text>
          <Segments
            value={photo}
            onChange={setPhoto}
            items={[0, 1, 2, 3, 4, 5].map((value) => ({
              value,
              label: value ? String(value) : "Пропустить",
            }))}
          />
          <Field
            accessibilityLabel="Что улучшить"
            placeholder="Что стоит улучшить?"
            multiline
            value={text}
            onChangeText={setText}
            maxLength={2000}
          />
          <State error={error} />
          <PrimaryButton
            label={busy ? "Отправляю…" : "Отправить отзыв"}
            disabled={busy}
            onPress={() => void send()}
          />
        </>
      )}
    </Panel>
  );
}
