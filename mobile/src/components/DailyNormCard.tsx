import { forwardRef } from "react";
import { Platform } from "react-native";
import Svg, { Circle, Ellipse, G, Image, Path, Rect, Text, TSpan } from "react-native-svg";
import { normNumber, normTitle, type DailyNorm } from "../sharing/dailyNorm";

const fontFamily = Platform.OS === "android" ? "sans-serif" : "Arial";

function NutrientIcon({ kind }: { kind: number }) {
  if (kind === 0) return <G><Path fill="#edb25e" stroke="#b8793c" d="M18 2.8c1.7 6.1 8.6 9.3 8.6 16.5A10.6 10.6 0 0 1 5.4 19c0-4.4 2.5-8.2 6.5-12.1-.5 4.5 1.4 6.5 2.6 7.4C18.3 11.2 18.5 6.5 18 2.8Z" /><Path fill="#fff0bd" d="M16.8 17c.4 3.6 4.1 4.8 4.1 7.5a4.9 4.9 0 0 1-9.8 0c0-2.8 3-5.5 5.7-7.5Z" /></G>;
  if (kind === 1) return <G><Path fill="#fff8dd" stroke="#b29c78" d="M16 3.3c-5.5 0-11 10.1-11 16.4a11 11 0 0 0 22 0C27 13.4 21.5 3.3 16 3.3Z" /><Circle cx="16" cy="20.4" r="5.2" fill="#eab653" /></G>;
  if (kind === 2) return <G><Path fill="#86a861" stroke="#567747" d="M16 3c-4.4 0-4.9 5.5-7.4 9.5C6 16.5 4.5 18.3 4.5 22A11.5 11.5 0 0 0 27.5 22c0-3.7-1.5-5.5-4.1-9.5C20.9 8.5 20.4 3 16 3Z" /><Path fill="#dbe7a6" d="M16 6.4c-2.2 0-3.2 5.1-5.3 8.2-1.8 2.9-3.1 4.8-3.1 7.3a8.4 8.4 0 0 0 16.8 0c0-2.5-1.3-4.4-3.1-7.3C19.2 11.5 18.2 6.4 16 6.4Z" /><Ellipse cx="16" cy="22" rx="4.4" ry="5.1" fill="#ae7753" /></G>;
  return <G><Path d="M16 29V7m0 20-5-4m5-2 5-4m-5-2-5-4" stroke="#a88846" strokeWidth="2" /><Path fill="#dcb867" stroke="#a88846" d="M16 9c-4.1-1.8-4.2-5.4 0-8 4.2 2.6 4.1 6.2 0 8ZM15.8 17c-6.7.2-9.5-2.6-9-8 5.4-.4 8.9 2.3 9 8ZM16.2 21c6.7.2 9.5-2.6 9-8-5.4-.4-8.9 2.3-9 8ZM15.8 26c-6.7.2-9.5-2.6-9-8 5.4-.4 8.9 2.3 9 8Z" /></G>;
}

// One SVG is used for both the preview and the 1080 × 216 PNG export.
export const DailyNormCard = forwardRef<Svg, { norm: DailyNorm; cat: string; onCatLoad: () => void }>(function DailyNormCard({ norm, cat, onCatLoad }, ref) {
  const metrics = [
    { x: 195, label: "Калории", value: norm.calories, unit: "ккал" },
    { x: 297, label: "Белки", value: norm.protein, unit: "г" },
    { x: 373, label: "Жиры", value: norm.fat, unit: "г" },
    { x: 449, label: "Углеводы", value: norm.carbs, unit: "г" },
  ];
  return <Svg ref={ref} width="100%" height="100%" viewBox="0 0 540 108">
    <Rect width="540" height="108" fill="#fbf8eb" />
    <Rect width="177" height="108" fill="#f4cf78" />
    <Circle cx="40.5" cy="82.5" r="72.5" fill="#ffe7ac" />
    <Path d="M177 0v108" stroke="#c9a65f" strokeWidth="1.5" strokeDasharray="4 3" />
    <Image href={cat} x="-4" y="9" width="110" height="110" transform="rotate(-5 51 64)" onLoad={onCatLoad} />
    <G transform="rotate(4 126 28)">
      <Rect x="82" y="9" width="88" height="38" rx="11" fill="#fffdf4" stroke="#423c2d" strokeWidth="1.7" />
      <Path d="m95 46 2 8 9-7" fill="#fffdf4" stroke="#423c2d" strokeWidth="1.7" strokeLinejoin="round" />
      <Text x="89" y="25" fontFamily={fontFamily} fontSize="11" fontWeight="700" letterSpacing="-0.3" fill="#35362c">ЭТО НА</Text>
      <Text x="89" y="37" fontFamily={fontFamily} fontSize="11" fontWeight="700" letterSpacing="-0.3" fill="#35362c">ВЕСЬ ДЕНЬ?!</Text>
    </G>
    <Text x="136" y="85" transform="rotate(13 150 74)" fontFamily={fontFamily} fontSize="29" fontWeight="700" fill="#b78037">?!</Text>
    <G fontFamily={fontFamily} fill="#274d35">
      <Text x="195" y="23" fontSize="11" fontWeight="700">{normTitle(norm)}</Text>
      {metrics.map((metric, index) => <G key={metric.label}>
        <G transform={`translate(${metric.x} 36) scale(.375)`}><NutrientIcon kind={index} /></G>
        <Text x={metric.x + 15} y="47" fontSize="7.4" fill="#869077">{metric.label}</Text>
        <Text x={metric.x} y="76" fontSize={String(metric.value).length > (index === 0 ? 4 : 3) ? 19 : 24} fontWeight="700" letterSpacing="-1">
          {normNumber(metric.value)}<TSpan dx="2" fontSize="7" fontWeight="400" letterSpacing="0">{metric.unit}</TSpan>
        </Text>
      </G>)}
      <Text x="195" y="98" fontSize="7" fill="#8c947d">Согласовано с котом. Почти.</Text>
      <G transform="translate(468 86) scale(.29)" stroke="#61784f" strokeLinecap="round" fill="none">
        <Path d="M35.96 21.84A16.5 16.5 0 1 0 38.96 35.99" strokeWidth="3.3" />
        <Path d="M32.2 27.5A10.2 10.2 0 1 0 32.2 36.5" strokeWidth="3" />
        <Path d="M34 33.5C43.8 33 46.6 26.4 46 19C39.6 20.5 33.1 25 34 33.5Z" fill="#61784f" strokeWidth="0" />
      </G>
      <Text x="484" y="99" fontSize="10" fontWeight="700" fill="#61784f">тарелка</Text>
    </G>
  </Svg>;
});
