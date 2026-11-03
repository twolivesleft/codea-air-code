-- A plugin for the Lua extension (LuaLS): teaches it two Codea idioms, by changing the text it reads, never the file

-- Every change is an insertion or a replacement at a position in the text
local function insertion(at, text) return { start = at, finish = at - 1, text = text } end

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

    -- x = require(asset.documents.Lib) returns the project's environment, its globals
    for start, finish in text:gmatch("=%s*()require%s*%(%s*asset[%w_%.]*%s*%)()") do
        diffs[#diffs + 1] = { start = start, finish = finish - 1, text = "_G" }
    end

    return #diffs > 0 and diffs or nil
end
