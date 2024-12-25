// App.js
import React, { useState } from "react";
import WelcomeScreen from "./components/WelcomeScreen";
import ChatScreen from "./components/ChatScreen";

const App = () => {
  const [gameStarted, setGameStarted] = useState(false);

  const handleStart = () => {
    setGameStarted(true);
    // Navigate to the game or load your main app here
  };

  return (
    <div>
      {gameStarted ? (
        <ChatScreen/>
      ) : (
        <WelcomeScreen onStart={handleStart} />
      )}
    </div>
  );
};

export default App;