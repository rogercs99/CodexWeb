# Snapshot file
# Unset all aliases to avoid conflicts with functions
# Functions
gawklibpath_append () 
{ 
    [ -z "$AWKLIBPATH" ] && AWKLIBPATH=`gawk 'BEGIN {print ENVIRON["AWKLIBPATH"]}'`;
    export AWKLIBPATH="$AWKLIBPATH:$*"
}
gawklibpath_default () 
{ 
    unset AWKLIBPATH;
    export AWKLIBPATH=`gawk 'BEGIN {print ENVIRON["AWKLIBPATH"]}'`
}
gawklibpath_prepend () 
{ 
    [ -z "$AWKLIBPATH" ] && AWKLIBPATH=`gawk 'BEGIN {print ENVIRON["AWKLIBPATH"]}'`;
    export AWKLIBPATH="$*:$AWKLIBPATH"
}
gawkpath_append () 
{ 
    [ -z "$AWKPATH" ] && AWKPATH=`gawk 'BEGIN {print ENVIRON["AWKPATH"]}'`;
    export AWKPATH="$AWKPATH:$*"
}
gawkpath_default () 
{ 
    unset AWKPATH;
    export AWKPATH=`gawk 'BEGIN {print ENVIRON["AWKPATH"]}'`
}
gawkpath_prepend () 
{ 
    [ -z "$AWKPATH" ] && AWKPATH=`gawk 'BEGIN {print ENVIRON["AWKPATH"]}'`;
    export AWKPATH="$*:$AWKPATH"
}

# setopts 3
set -o braceexpand
set -o hashall
set -o interactive-comments

# aliases 0

# exports 19
declare -x CODEX_CMD="codex"
declare -x CODEX_HOME="/root/CodexWeb/.codex_users/user_1"
declare -x CODEX_MANAGED_BY_NPM="1"
declare -x HOME="/root"
declare -x HOST="127.0.0.1"
declare -x INVOCATION_ID="c3cf45d94e7343d9aaac377cd8fb558f"
declare -x JOURNAL_STREAM="8:89573330"
declare -x LANG="en_US.UTF-8"
declare -x LOGNAME="root"
declare -x NODE_ENV="development"
declare -x OPENAI_API_KEY=""
declare -x PATH="/root/CodexWeb/.codex_users/user_1/tmp/arg0/codex-arg09BAjJU:/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/path:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"
declare -x PORT="3050"
declare -x SESSION_SECRET="f3bf75a921b83a5b5c339bc6d8ada56a8c0ccc155fdec710eede7adadb20fb64"
declare -x SHELL="/bin/sh"
declare -x SHLVL="1"
declare -x SYSTEMD_EXEC_PID="1890921"
declare -x USER="root"
declare -x XDG_DATA_DIRS="/usr/local/share:/usr/share:/var/lib/snapd/desktop"
