import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, PanResponder } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { colors } from '../theme';
import { useColors } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import Sidebar from '../components/Sidebar';
import { navigate } from './navigationRef';

import AuthScreen from '../screens/AuthScreen';
import ChatConversationScreen from '../screens/ChatConversationScreen';
import TravelScreen from '../screens/TravelScreen';
import ToolsScreen from '../screens/ToolsScreen';
import PlansScreen from '../screens/PlansScreen';
import DeveloperScreen from '../screens/DeveloperScreen';
import AccountScreen from '../screens/AccountScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ConnectorsScreen from '../screens/ConnectorsScreen';
import TeamScreen from '../screens/TeamScreen';
import SchedulesScreen from '../screens/SchedulesScreen';
import ImportScreen from '../screens/ImportScreen';
import VerifyEmailScreen from '../screens/VerifyEmailScreen';
import MenuScreen from '../screens/MenuScreen';
import LibraryScreen from '../screens/LibraryScreen';
import ProfileScreen from '../screens/ProfileScreen';
import UsageScreen from '../screens/UsageScreen';
import VoiceScreen from '../screens/VoiceScreen';
import MemoryScreen from '../screens/MemoryScreen';

const Stack = createNativeStackNavigator();

// All app screens live in one stack. The red drawer (Sidebar) is an overlay that
// slides in over the content.
function AppStack() {
  const { sidebarOpen, openSidebar } = useUI();

  // Left-edge swipe opens the drawer, via RN's built-in PanResponder (NOT
  // react-native-gesture-handler, which needs reanimated — absent here, and it
  // crashed on drag). This is attached to a WRAPPER around the content, not an
  // overlay strip: an absolutely-positioned strip sat on top of the screen's
  // left edge and swallowed taps meant for buttons underneath it (the composer's
  // "+"). As a wrapper we never claim the touch on start, so taps pass straight
  // through to children; we only claim it once a horizontal drag begins near the
  // left edge.
  const openRef = useRef(openSidebar); openRef.current = openSidebar;
  const openState = useRef(sidebarOpen); openState.current = sidebarOpen;
  const edgePan = useRef(PanResponder.create({
    // Never take over on a plain touch — buttons must keep working.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (e, g) => (
      !openState.current &&
      e.nativeEvent.pageX - g.dx < 60 &&          // drag began near the left edge
      g.dx > 12 &&                                 // moving right
      Math.abs(g.dx) > Math.abs(g.dy) * 1.5        // clearly horizontal, not a scroll
    ),
    onPanResponderRelease: (_e, g) => { if (g.dx > 40 || g.vx > 0.3) openRef.current(); },
  })).current;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} {...edgePan.panHandlers}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="ChatConversation" component={ChatConversationScreen} />
        <Stack.Screen name="Travel" component={TravelScreen} />
        <Stack.Screen name="Tools" component={ToolsScreen} />
        <Stack.Screen name="Plans" component={PlansScreen} />
        <Stack.Screen name="Developer" component={DeveloperScreen} />
        <Stack.Screen name="Account" component={AccountScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Connectors" component={ConnectorsScreen} />
        <Stack.Screen name="Team" component={TeamScreen} />
        <Stack.Screen name="Schedules" component={SchedulesScreen} />
        <Stack.Screen name="Import" component={ImportScreen} />
        <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
        <Stack.Screen name="Menu" component={MenuScreen} />
        <Stack.Screen name="Library" component={LibraryScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Usage" component={UsageScreen} />
        <Stack.Screen name="Voice" component={VoiceScreen} />
        <Stack.Screen name="Memory" component={MemoryScreen} />
      </Stack.Navigator>

      {/* Red drawer overlay (handles its own slide + backdrop). */}
      <Sidebar />

    </View>
  );
}

export default function RootNavigator() {
  const { token, ownerId, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  return token && ownerId ? <AppStack key={ownerId} /> : <AuthScreen />;
}
