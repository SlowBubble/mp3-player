// Global variables
let currentTracks = [];
let currentTrackIndex = 0;
let audioPlayer = null;
let isPlaying = false;
let playbackRates = [1, 1.15, 1.25, 1.35];
let currentRateIndex = 0;
let progressUpdateInterval = null;

// DOM elements
const fileInput = document.getElementById('file-input');
const playlist = document.getElementById('playlist');
const emptyState = document.getElementById('empty-state');
const homePage = document.getElementById('home-page');
const playerPage = document.getElementById('player-page');
const playerControls = document.getElementById('player-controls');
const currentTrackTitle = document.getElementById('current-track-title');
const playPauseBtn = document.getElementById('play-pause-btn');
const progressFill = document.getElementById('progress-fill');
const currentTimeSpan = document.getElementById('current-time');
const totalTimeSpan = document.getElementById('total-time');
const progressBar = document.getElementById('progress-bar');

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    audioPlayer = document.getElementById('audio-player');
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    // File input change
    fileInput.addEventListener('change', handleFileSelection);
    
    // Audio player events
    audioPlayer.addEventListener('loadedmetadata', updateDuration);
    audioPlayer.addEventListener('timeupdate', updateProgress);
    audioPlayer.addEventListener('ended', handleTrackEnd);
    audioPlayer.addEventListener('canplay', function() {
        // Auto-play when track is ready (mobile browsers may block this)
        if (isPlaying) {
            audioPlayer.play().catch(e => console.log('Auto-play blocked:', e));
        }
    });
    
    // Progress bar click
    progressBar.addEventListener('click', seekToPosition);
}

// Handle file selection
function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    const mp3Files = files.filter(file => file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3'));
    
    if (mp3Files.length === 0) {
        alert('No MP3 files found in the selected folder.');
        return;
    }
    
    currentTracks = mp3Files.map((file, index) => ({
        id: index,
        name: file.name.replace('.mp3', ''),
        file: file,
        url: URL.createObjectURL(file)
    }));
    
    displayPlaylist();
    emptyState.style.display = 'none';
}

// Display playlist
function displayPlaylist() {
    playlist.innerHTML = '';
    
    currentTracks.forEach((track, index) => {
        const trackElement = document.createElement('div');
        trackElement.className = 'track-item';
        trackElement.onclick = () => playTrack(index);
        
        // Get stored progress for this track
        const progressData = getTrackProgress(track.name);
        let durationText = '';
        let progressPercentage = 0;
        
        if (progressData) {
            const currentTimeFormatted = formatTime(progressData.currentTime);
            const durationFormatted = formatTime(progressData.duration);
            durationText = `${currentTimeFormatted} / ${durationFormatted}`;
            progressPercentage = (progressData.currentTime / progressData.duration) * 100;
        }
        
        trackElement.innerHTML = `
            <div class="track-name">${track.name}</div>
            ${durationText ? `<div class="track-duration">${durationText}</div>` : ''}
            <div class="track-progress">
                <div class="track-progress-bar">
                    <div class="track-progress-fill" style="width: ${progressPercentage}%"></div>
                </div>
            </div>
        `;
        
        playlist.appendChild(trackElement);
    });
}

// Play a specific track
function playTrack(index) {
    if (index < 0 || index >= currentTracks.length) return;
    
    currentTrackIndex = index;
    const track = currentTracks[index];
    
    // Update UI
    currentTrackTitle.textContent = track.name;
    
    // Load and play audio
    audioPlayer.src = track.url;
    audioPlayer.load();
    
    // Show player page
    showPlayerPage();
    
    // Start playing
    isPlaying = true;
    updatePlayPauseButton();
    
    // Setup Media Session API for background playback
    setupMediaSession(track);
    
    // Start progress tracking interval
    startProgressTracking(track.name);
    
    // Restore saved position when metadata is loaded
    audioPlayer.addEventListener('loadedmetadata', function restorePosition() {
        const progressData = getTrackProgress(track.name);
        if (progressData && progressData.currentTime > 0) {
            audioPlayer.currentTime = progressData.currentTime;
        }
        // Remove this listener after use
        audioPlayer.removeEventListener('loadedmetadata', restorePosition);
    });
    
    // Try to play (may be blocked on mobile until user interaction)
    audioPlayer.play().catch(e => {
        console.log('Play blocked, waiting for user interaction:', e);
        isPlaying = false;
        updatePlayPauseButton();
    });
}

// Toggle play/pause
function togglePlayPause() {
    if (!audioPlayer.src) return;
    
    if (isPlaying) {
        audioPlayer.pause();
        isPlaying = false;
        
        // Save progress immediately when pausing
        const track = currentTracks[currentTrackIndex];
        if (track && audioPlayer.duration) {
            const currentTime = audioPlayer.currentTime;
            const duration = audioPlayer.duration;
            const timeToSave = (duration - currentTime < 30) ? 0 : currentTime;
            
            const progressData = {
                duration: duration,
                currentTime: timeToSave
            };
            saveTrackProgress(track.name, progressData);
        }
    } else {
        audioPlayer.play().then(() => {
            isPlaying = true;
        }).catch(e => {
            console.log('Play failed:', e);
            isPlaying = false;
        });
    }
    
    updatePlayPauseButton();
    updateMediaSessionState();
}

// Update play/pause button
function updatePlayPauseButton() {
    playPauseBtn.textContent = isPlaying ? '⏸️' : '▶️';
    playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
}

// Rewind 15 seconds
function rewind15() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 15);
    }
}

// Forward 15 seconds
function forward15() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 15);
    }
}

// Rewind 5 minutes
function rewind5min() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 300);
    }
}

// Forward 5 minutes
function forward5min() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 300);
    }
}

// Previous track
function previousTrack() {
    if (currentTrackIndex > 0) {
        playTrack(currentTrackIndex - 1);
    }
}

// Next track
function nextTrack() {
    if (currentTrackIndex < currentTracks.length - 1) {
        playTrack(currentTrackIndex + 1);
    }
}

// Toggle playback rate
function togglePlaybackRate() {
    if (!audioPlayer.src) return;
    
    currentRateIndex = (currentRateIndex + 1) % playbackRates.length;
    const newRate = playbackRates[currentRateIndex];
    
    audioPlayer.playbackRate = newRate;
    
    // Update button text
    const rateBtn = document.getElementById('playback-rate-btn');
    rateBtn.textContent = newRate + 'x';
    
    // Update Media Session if available
    updateMediaSessionState();
}

// Update duration display
function updateDuration() {
    if (audioPlayer.duration) {
        totalTimeSpan.textContent = formatTime(audioPlayer.duration);
        
        // Store duration in localStorage when first loaded
        const track = currentTracks[currentTrackIndex];
        if (track) {
            const progressData = getTrackProgress(track.name) || {};
            progressData.duration = audioPlayer.duration;
            saveTrackProgress(track.name, progressData);
        }
    }
}

// Update progress
function updateProgress() {
    if (audioPlayer.duration) {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressFill.style.width = progress + '%';
        currentTimeSpan.textContent = formatTime(audioPlayer.currentTime);
        
        // Update Media Session position periodically
        updateMediaSessionState();
    }
}

// Handle track end
function handleTrackEnd() {
    isPlaying = false;
    updatePlayPauseButton();
    
    // Save progress as completed (reset to 0)
    const track = currentTracks[currentTrackIndex];
    if (track && audioPlayer.duration) {
        const progressData = {
            duration: audioPlayer.duration,
            currentTime: 0
        };
        saveTrackProgress(track.name, progressData);
    }
    
    // Auto-play next track if available
    if (currentTrackIndex < currentTracks.length - 1) {
        playTrack(currentTrackIndex + 1);
    }
}

// Seek to position
function seekToPosition(event) {
    if (!audioPlayer.duration) return;
    
    const rect = progressBar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * audioPlayer.duration;
    
    audioPlayer.currentTime = newTime;
}

// Format time (seconds to mm:ss)
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Show home page
function showHomePage() {
    homePage.classList.add('active');
    playerPage.classList.remove('active');
    playerControls.style.display = 'none';
    
    // Stop progress tracking
    stopProgressTracking();
    
    // Pause audio when going back
    if (isPlaying) {
        audioPlayer.pause();
        isPlaying = false;
        updatePlayPauseButton();
    }
    
    // Refresh playlist to show updated progress
    if (currentTracks.length > 0) {
        displayPlaylist();
    }
}

// Show player page
function showPlayerPage() {
    homePage.classList.remove('active');
    playerPage.classList.add('active');
    playerControls.style.display = 'block';
}

// Setup Media Session API for background playback
function setupMediaSession(track) {
    if ('mediaSession' in navigator) {
        // Set metadata
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: 'Unknown Artist',
            album: 'Local Files',
            artwork: [
                { src: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiBmaWxsPSIjMzMzIi8+Cjx0ZXh0IHg9IjI1NiIgeT0iMjU2IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iNDAiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+4pmqPC90ZXh0Pgo8L3N2Zz4K', sizes: '512x512', type: 'image/svg+xml' }
            ]
        });

        // Set action handlers
        navigator.mediaSession.setActionHandler('play', () => {
            audioPlayer.play();
            isPlaying = true;
            updatePlayPauseButton();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            audioPlayer.pause();
            isPlaying = false;
            updatePlayPauseButton();
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipTime = details.seekOffset || 15;
            audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - skipTime);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipTime = details.seekOffset || 15;
            audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + skipTime);
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            previousTrack();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            nextTrack();
        });

        // Update playback state
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
}

// Update Media Session playback state
function updateMediaSessionState() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        
        // Update position state for better scrubbing support
        if (audioPlayer.duration) {
            navigator.mediaSession.setPositionState({
                duration: audioPlayer.duration,
                playbackRate: audioPlayer.playbackRate,
                position: audioPlayer.currentTime
            });
        }
    }
}

// Handle mobile-specific behaviors
document.addEventListener('visibilitychange', function() {
    // Don't pause when tab becomes hidden - let Media Session API handle it
    // This allows background playback on mobile
    console.log('Visibility changed:', document.hidden ? 'hidden' : 'visible');
});

// Prevent zoom on double tap for better mobile experience
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

// Local Storage Functions for Progress Tracking
function getTrackProgress(fileName) {
    try {
        const stored = localStorage.getItem(fileName);
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.error('Error reading progress from localStorage:', e);
        return null;
    }
}

function saveTrackProgress(fileName, progressData) {
    try {
        localStorage.setItem(fileName, JSON.stringify(progressData));
    } catch (e) {
        console.error('Error saving progress to localStorage:', e);
    }
}

function startProgressTracking(fileName) {
    // Clear any existing interval
    stopProgressTracking();
    
    // Update progress every 30 seconds
    progressUpdateInterval = setInterval(() => {
        if (audioPlayer && audioPlayer.duration && !isNaN(audioPlayer.currentTime)) {
            const currentTime = audioPlayer.currentTime;
            const duration = audioPlayer.duration;
            
            // Reset current time to 0 if within 1 minute of the end
            const timeToSave = (duration - currentTime < 60) ? 0 : currentTime;
            
            const progressData = {
                duration: duration,
                currentTime: timeToSave
            };
            
            saveTrackProgress(fileName, progressData);
        }
    }, 30000); // 30 seconds
}

function stopProgressTracking() {
    if (progressUpdateInterval) {
        clearInterval(progressUpdateInterval);
        progressUpdateInterval = null;
    }
}