import { Host, List, ListItem, Text as ExpoText } from "@expo/ui";
import { StatusBar } from "expo-status-bar";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PLAYGROUND_GAMES, type PlaygroundGameId } from "../../catalog/games";

/** Catalog surface for the playground examples. */
export default function HomeScreen({
  onOpenGame,
}: {
  readonly onOpenGame: (gameId: PlaygroundGameId) => void;
}) {
  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      {/* Light catalog surface: dark status-bar text overrides the shell's
          global light-on-dark bar; unmounting restores it for game screens. */}
      <StatusBar style="dark" />
      <Host colorScheme="light" seedColor="#6558D9" style={styles.host}>
        <ExpoText
          style={styles.header}
          textStyle={textStyles.headerTitle}
        >
          {"React Native GameKit\nPlayground"}
        </ExpoText>
        <ExpoText
          style={styles.subheader}
          textStyle={textStyles.headerSubtitle}
        >
          Small games, built with the same runtime you can use in your app.
        </ExpoText>
        <List testID="showcase-home-list">
          {PLAYGROUND_GAMES.map((game) => (
            <ListItem
              key={game.id}
              onPress={() => onOpenGame(game.id)}
              supportingText={game.description}
              testID={`home-component-${game.id}`}
              trailing="›"
            >
              <ExpoText textStyle={textStyles.itemTitle}>{game.title}</ExpoText>
            </ListItem>
          ))}
        </List>
      </Host>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  host: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  subheader: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
  },
});

const textStyles = StyleSheet.create({
  headerTitle: {
    color: "#18181b",
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  headerSubtitle: {
    color: "#52525b",
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 420,
  },
  itemTitle: {
    color: "#18181b",
    fontSize: 17,
    fontWeight: "500",
  },
});
