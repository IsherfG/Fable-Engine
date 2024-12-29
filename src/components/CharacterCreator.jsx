import React, { useState } from "react";
import "./CharacterCreator.css";

const initialStats = {
    Strength: 8,
    Dexterity: 8,
    Intelligence: 8,
    Wisdom: 8,
    Charisma: 8,
};

const CharacterCreator = ({ onFinish }) => {
    const [stats, setStats] = useState(initialStats);
    const [remainingPoints, setRemainingPoints] = useState(20);
    const [profileImage, setProfileImage] = useState(null);
     const [step, setStep] = useState(1);
      const [validationMessage, setValidationMessage] = useState(""); // New state variable

    const handleIncrease = (stat) => {
        if (remainingPoints > 0) {
           setValidationMessage(""); // Clear the validation message
            setStats((prevStats) => ({ ...prevStats, [stat]: prevStats[stat] + 1 }));
            setRemainingPoints((prevPoints) => prevPoints - 1);
        }
    };

    const handleDecrease = (stat) => {
         setValidationMessage(""); // Clear the validation message
        if (stats[stat] > 1) {
            setStats((prevStats) => ({ ...prevStats, [stat]: prevStats[stat] - 1 }));
            setRemainingPoints((prevPoints) => prevPoints + 1);
        }
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            setProfileImage(URL.createObjectURL(file));
        }
    };

     const handleRemoveImage = () => {
        setProfileImage(null);
    };

      const handleNext = () => {
        if (step === 1) {
            if (remainingPoints === 0) {
                 setStep(2);
            } else {
                 setValidationMessage("You must use all your remaining stat points before continuing.");
           }
        } else if (step === 2){
          setStep(3);
        }
      };
     const handleSkipProfile = () => {
       setStep(3);
     };
     const handleFinish = () => {
        onFinish({ stats, profileImage });
    };

    return (
        <div className="character-creator">
              <h1>Create Your Character: Step {step}</h1>
              {step === 1 && (
            <div className="stats-container">
                <h2>Allocate Stats</h2>
                <p>Remaining Points: {remainingPoints}</p>
                <div className="stats-list">
                    {Object.keys(stats).map((stat) => (
                        <div key={stat} className="stat-item">
                            <span>{stat}</span>
                            <div className="stat-controls">
                                <button onClick={() => handleDecrease(stat)}>-</button>
                                <span>{stats[stat]}</span>
                                <button onClick={() => handleIncrease(stat)}>+</button>
                            </div>
                        </div>
                    ))}
                </div>
                     {validationMessage && <p className="validation-message">{validationMessage}</p>}
                    <button className="next-button" onClick={handleNext}>Next</button>
            </div>
         )}

           {step === 2 && (
               <div className="profile-image-container">
                    <h2>Upload Character Art</h2>
                    <input type="file" onChange={handleImageUpload} />
                    {profileImage && (
                         <div className="image-preview-container">
                           <img src={profileImage} alt="Character Art" />
                            <button onClick={handleRemoveImage} className="remove-image-button">Remove</button>
                       </div>
                    )}
                    <div className="profile-button-container">
                         <button className="skip-button" onClick={handleSkipProfile}>Skip</button>
                         <button className="next-button" onClick={handleNext}>Next</button>
                     </div>
                </div>
              )}


            {step === 3 && (
             <button className="finish-button" onClick={handleFinish}>
                Finish & Start Adventure
            </button>
           )}
        </div>
    );
};

export default CharacterCreator;