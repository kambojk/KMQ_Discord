#!/bin/bash
set -e

rebuild () {
    echo "Compiling typescript..."
    npx tsc
}

if [[ $1 == 'native' ]]
then
    if [ "${NODE_ENV}" == "production" ]; then
        echo "Cleaning project..."
        npm run clean
        echo "Installing dependencies..."
        yarn install --frozen-lockfile
    fi
    rebuild
fi

echo "Killing running instances..."
ps x | grep node | grep "${PWD}/" | egrep "kmq\.js|cluster_manager\.js" | awk '{print $1}' | xargs kill &> /dev/null || echo "No running instances to kill"
echo "Bootstrapping..."
node build/seed/bootstrap.js
echo "Starting bot..."
cd build/
if [ "${NODE_ENV}" == "dry-run" ] || [ "${NODE_ENV}" == "ci" ]; then
    exec node "${PWD}/kmq.js"
elif [ "${NODE_ENV}" == "development" ]; then
    exec node --inspect=9229 "${PWD}/kmq.js"
elif [ "${NODE_ENV}" == "production" ]; then
    git log -n 1 --pretty=format:"%H" > ../version
    exec node "${PWD}/kmq.js"
fi
