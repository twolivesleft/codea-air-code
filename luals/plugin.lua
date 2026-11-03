-- A plugin for the Lua extension (LuaLS): teaches it Codea's idioms, by changing the text it reads, never the file

-- Every change is an insertion or a replacement at a position in the text
local function insertion(at, text) return { start = at, finish = at - 1, text = text } end

-- What each kind of parameter holds, as a value of that type
local PARAMETER_VALUES = { number = "0.0", integer = "0", boolean = "false", text = '""', color = "color()" }

function OnSetText(uri, text)
    if not uri:match("%.lua$") then
        return nil
    end
    local diffs = {}

    -- Ship = class() or class(Base): a type, whose instances Ship(...) returns
    for at, name in text:gmatch("()([%a_][%w_]*)%s*=%s*class%s*%(") do
        if at == 1 or text:sub(at - 1, at - 1) == "\n" then
            diffs[#diffs + 1] = insertion(at, ("---@class %s\n---@overload fun(...): %s\n"):format(name, name))
        end
    end

    -- parameter.boolean("Name", ...) and the like, starting a line, create the global Name
    for at, kind, name in ("\n" .. text):gmatch("\n[ \t]*()parameter%.(%a+)%s*%(%s*[\"']([%a_][%w_]*)[\"']") do
        local value = PARAMETER_VALUES[kind]
        if value then
            diffs[#diffs + 1] = insertion(at - 1, ("%s = %s; "):format(name, value))
        end
    end

    -- x = require(asset.documents.Lib) returns the project's environment, its globals
    for start, finish in text:gmatch("=%s*()require%s*%(%s*asset[%w_%.]*%s*%)()") do
        diffs[#diffs + 1] = { start = start, finish = finish - 1, text = "_G" }
    end

    table.sort(diffs, function (a, b) return a.start < b.start end)
    return #diffs > 0 and diffs or nil
end
