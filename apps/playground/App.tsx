import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { PlaygroundStackParamList } from './src/navigation/types';
import BootstrapGameScreen from './src/screens/BootstrapGameScreen';
import HomeScreen from './src/screens/HomeScreen';

const Stack = createNativeStackNavigator<PlaygroundStackParamList>();

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#080b12',
    card: '#080b12',
    primary: '#8b5cf6',
  },
};

/** Playground shell that will grow into the example game catalog. */
export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: '#080b12' },
            headerShown: false,
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="BootstrapGame" component={BootstrapGameScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
