import React, { useState } from "react";
import CharacterCreator from "./components/CharacterCreator";
import ChatScreenWithLevel from "./components/ChatScreen";
import WelcomeScreen from "./components/WelcomeScreen";

const App = () => {
  const [screen, setScreen] = useState("welcome");
  const [character, setCharacter] = useState(null);

  const handleStartAdventure = () => setScreen("character-creator");
  const handleCharacterCreation = (charData) => {
    setCharacter(charData);
    setScreen("chat");
  };

  return (
    <div>
      {screen === "welcome" && <WelcomeScreen onStart={handleStartAdventure} />}
      {screen === "character-creator" && (
        <CharacterCreator onFinish={handleCharacterCreation} />
      )}
      {screen === "chat" && <ChatScreenWithLevel character={character} />}
    </div>
  );
};

export default App;