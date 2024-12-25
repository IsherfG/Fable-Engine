// ChatScreenWithLevel.js
import React, { useState } from "react";
import "./ChatScreen.css";

const ChatScreenWithLevel = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const sendMessage = () => {
    if (!input.trim()) return;

    // Simulate AI response
    const userMessage = { text: input, sender: "user", timestamp: new Date() };
    const aiResponse = {
      text: "I understand your request. What would you like to do next?",
      sender: "ai",
      timestamp: new Date(),
    };

    setMessages([...messages, userMessage, aiResponse]);
    setInput("");
  };

  return (
    <div className="chat-level-container">
      {/* Chat Section */}
      <div className="chat-container">
        <div className="chat-header">
          <h1>Welcome to AI Dungeon Master</h1>
        </div>
        <div className="chat-messages">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`message ${msg.sender === "user" ? "user" : "ai"}`}
            >
              <p>{msg.text}</p>
              <span className="timestamp">
                {msg.timestamp.toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
        <div className="chat-input">
          <input
            type="text"
            placeholder="Type your command..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          />
          <button onClick={sendMessage}>Send</button>
        </div>
      </div>

      {/* Level Info Section */}
      <div className="level-info">
        <h2>Level 5</h2>
        <div className="stat">
          <label>Health</label>
          <div className="bar">
            <div className="fill health" style={{ width: "75%" }}></div>
          </div>
        </div>
        <div className="stat">
          <label>Mana</label>
          <div className="bar">
            <div className="fill mana" style={{ width: "50%" }}></div>
          </div>
        </div>
        <div className="stat">
          <label>Experience</label>
          <div className="bar">
            <div className="fill experience" style={{ width: "34%" }}></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatScreenWithLevel;