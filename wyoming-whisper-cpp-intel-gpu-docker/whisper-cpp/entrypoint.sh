#!/bin/bash
set -m # Enable Job Control

# The command to run is passed as arguments to this script
COMMAND=("$@")

# Exit if no command is provided
if [ ${#COMMAND[@]} -eq 0 ]; then
    echo "Error: No command specified." >&2
    exit 1
fi

# Start the actual server command in the background
"${COMMAND[@]}" &
SERVER_PID=$!

echo "Started server process ${SERVER_PID} with command: ${COMMAND[*]}"

# Monitor function
monitor_cpu() {
    # Give the server some time to initialize before starting checks
    sleep 15

    local doom_count=0
    # Loop as long as the server process is alive
    while kill -0 "${SERVER_PID}" 2>/dev/null; do
       # Use pidstat to check CPU usage for the server process over 1 second.
       # awk checks if the %CPU (column 8) is >= 99.0 and prints 1 for high CPU, 0 otherwise.
       is_high=$(pidstat -p "${SERVER_PID}" 1 1 | awk 'END{if ($8 >= 99.0) print 1; else print 0}')

       if [[ "${is_high}" -eq 1 ]]; then
           ((doom_count++))
           echo >&2 "High CPU usage detected. Doom count: ${doom_count}/3"
       else
           # Reset counter if CPU usage is normal
           doom_count=0
       fi

       # If high CPU is detected for 3 consecutive seconds, kill the process
       if [[ "${doom_count}" -ge 3 ]]; then
           echo >&2 "Server process ${SERVER_PID} deemed 'doomed' (high CPU for ${doom_count}s). Killing."
           kill -9 "${SERVER_PID}"
           break # Exit monitor loop
       fi
    done
    echo >&2 "CPU monitor for process ${SERVER_PID} has stopped."
}

# Run the monitor in the background
monitor_cpu &

# Wait for the server process to exit. This keeps the container alive.
# If the monitor kills the server, 'wait' will unblock and the script will exit,
# causing the container to stop and be restarted by Docker via 'restart: always'.
wait "${SERVER_PID}"
exit $?