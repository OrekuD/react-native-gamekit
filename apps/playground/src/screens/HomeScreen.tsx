import {
  Column,
  Host,
  ListItem,
  ScrollView as ExpoScrollView,
  Text as ExpoText,
} from "@expo/ui";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { StyleSheet } from "react-native";

import type { PlaygroundStackParamList } from "../navigation/types";

const GAMES = [
  {
    id: "bootstrap",
    route: "BootstrapGame" as const,
    title: "First runtime slice",
    description: "A moving Skia circle driven by a fixed-step GameSession.",
    label: "Play",
  },
];

type HomeScreenProps = NativeStackScreenProps<PlaygroundStackParamList, "Home">;

/** Native-styled catalog surface for the playground examples. */
export default function HomeScreen({ navigation }: HomeScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <Host
        colorScheme="dark"
        seedColor="#7c3aed"
        style={styles.listHost}
        useViewportSizeMeasurement
      >
        <ExpoScrollView
          showsIndicators={false}
          style={{ paddingHorizontal: 24 }}
          testID="game-scroll-view"
        >
          <Column
            alignment="start"
            spacing={8}
            style={{
              paddingBottom: 20,
              paddingTop: 24,
            }}
            testID="playground-header"
          >
            <ExpoText textStyle={styles.headerTitle}>
              {"React Native GameKit\nPlayground"}
            </ExpoText>
            <ExpoText textStyle={styles.headerSubtitle}>
              Small games, built with the same runtime you can use in your app.
            </ExpoText>
          </Column>
          {GAMES.map((game) => (
            <ListItem
              key={game.id}
              onPress={() => navigation.navigate(game.route)}
              supportingText={game.description}
              testID={`game-row-${game.id}`}
              trailing={
                <ExpoText textStyle={styles.nativeTrailing}>
                  {game.label}
                </ExpoText>
              }
            >
              {game.title}
            </ListItem>
          ))}
        </ExpoScrollView>
      </Host>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#080b12",
  },
  headerTitle: {
    color: "#f4f4f5",
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  headerSubtitle: {
    color: "#a1a1aa",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 420,
  },
  listHost: {
    flex: 1,
    minHeight: 160,
  },
  nativeTrailing: {
    color: "#a78bfa",
    fontWeight: "700",
  },
});
