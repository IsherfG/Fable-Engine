import React, { useState } from "react";
import CharacterCreator from "./components/CharacterCreator";
import ChatScreenWithLevel from "./components/ChatScreen";
import WelcomeScreen from "./components/WelcomeScreen";

// Main application component that manages screen transitions and character data.
const App = () => {
    // State to track the current screen: welcome, character-creator, or chat.
    const [screen, setScreen] = useState("welcome");
    // State to store the character data created by CharacterCreator.
    const [character, setCharacter] = useState(null);

    // Function to transition to the character creation screen.
    const handleStartAdventure = () => setScreen("character-creator");

    // Function to handle character data after creation.
    // It saves the character data and switches to the chat screen.
    const handleCharacterCreation = (charData) => {
        setCharacter(charData);
        setScreen("chat");
    };

    return (
        <div>
            {/* Conditional rendering of screens based on the 'screen' state */}
            {screen === "welcome" && <WelcomeScreen onStart={handleStartAdventure} />}
            {screen === "character-creator" && (
                <CharacterCreator onFinish={handleCharacterCreation} />
            )}
            {screen === "chat" && <ChatScreenWithLevel character={character} />}
        </div>
    );
};

export default App;