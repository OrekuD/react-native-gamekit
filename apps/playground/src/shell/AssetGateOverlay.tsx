import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameAssetsState } from 'rn-gamekit/react';

export function AssetGateOverlay({
  gameId,
  assetState,
  onRetry,
  onExit,
}: {
  readonly gameId: string | null;
  readonly assetState?: GameAssetsState<import('rn-gamekit').AssetGroupMap>;
  readonly onRetry?: () => void;
  readonly onExit: () => void;
}) {
  const isError = assetState?.status === 'error';
  const errorMessage = isError
    ? String((assetState as { error: unknown })?.error ?? 'Unknown error')
    : undefined;
  // Prefer the state's retry when available; fall back to the explicit prop.
  const retryFn = (assetState as { retry?: () => void })?.retry ?? onRetry;
  return (
    <View
      style={styles.assetGate}
      pointerEvents="auto"
      testID="asset-gate-overlay"
      accessibilityViewIsModal
    >
      <View style={styles.assetGateCard}>
        <Text style={styles.assetGateTitle}>
          {isError ? 'Failed to load' : `Loading ${gameId ?? 'game'}…`}
        </Text>
        {isError ? (
          <Text style={styles.assetGateError} testID="asset-gate-error">
            {errorMessage}
          </Text>
        ) : (
          <ActivityIndicator testID="asset-gate-loading" />
        )}
        <View style={styles.assetGateRow}>
          {isError && retryFn !== undefined ? (
            <Pressable
              onPress={retryFn}
              testID="asset-gate-retry"
              accessibilityRole="button"
              style={styles.assetGateButton}
            >
              <Text style={styles.assetGateButtonText}>Retry</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onExit}
            testID="asset-gate-back"
            accessibilityRole="button"
            style={styles.assetGateButton}
          >
            <Text style={styles.assetGateButtonText}>Back</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  assetGate: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(8, 11, 18, 0.92)',
    justifyContent: 'center',
    padding: 24,
  },
  assetGateCard: {
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    gap: 12,
    maxWidth: 320,
    padding: 20,
    width: '100%',
  },
  assetGateTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  assetGateError: {
    color: '#fca5a5',
    fontSize: 12,
    textAlign: 'center',
  },
  assetGateRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  assetGateButton: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  assetGateButtonText: {
    color: 'white',
    fontWeight: '700',
    textAlign: 'center',
  },
});
