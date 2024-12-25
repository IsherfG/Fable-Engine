// WelcomeScreen.js
import React from "react";
import "./WelcomeScreen.css";

const WelcomeScreen = ({ onStart }) => {
  return (
    <div className="welcome-container">
      <h1 className="welcome-title">Welcome to Fable Engine</h1>
      <p className="welcome-subtitle">
        Embark on a journey where your imagination drives the story!
      </p>
      <button className="start-button" onClick={onStart}>
        Start Your Adventure
      </button>
    </div>
  );
};

export default WelcomeScreen;