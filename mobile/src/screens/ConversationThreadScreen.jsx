import React, { useLayoutEffect } from 'react';
import { View } from 'react-native';
import ChatThread from '../components/ChatThread';
import { commonStyles } from '../theme';

export default function ConversationThreadScreen({ route, navigation }) {
  const { conversationId, tutorName } = route.params;

  useLayoutEffect(() => {
    navigation.setOptions({ title: tutorName || 'Conversation' });
  }, [navigation, tutorName]);

  return (
    <View style={commonStyles.screen}>
      <ChatThread conversationId={conversationId} otherPartyLabel={tutorName || 'Them'} />
    </View>
  );
}
